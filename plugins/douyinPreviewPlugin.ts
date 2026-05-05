import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function isAllowedDouyinHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "douyin.com" ||
    h.endsWith(".douyin.com") ||
    h === "iesdouyin.com" ||
    h.endsWith(".iesdouyin.com")
  );
}

function parsePageUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!isAllowedDouyinHost(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

function extractCoverFromHtml(html: string): string | null {
  const metaOg = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  ];
  for (const re of metaOg) {
    const m = html.match(re);
    if (m?.[1]) return decodeDouyinEscapes(m[1]);
  }
  const m2 = html.match(/"coverUrl":\s*"([^"]+)"/);
  if (m2?.[1]) return decodeDouyinEscapes(m2[1]);
  const m3 = html.match(/"video":\s*\{[^}]*"cover":\s*\{[^}]*"url_list":\s*\[\s*"([^"]+)"/);
  if (m3?.[1]) return decodeDouyinEscapes(m3[1]);
  return null;
}

/** 多次 decodeURIComponent，处理 goods_detail 双重编码 */
function deeplyDecodeQueryValue(s: string): string {
  let out = s;
  for (let i = 0; i < 6; i++) {
    try {
      const next = decodeURIComponent(out.replace(/\+/g, " "));
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  return out;
}

/**
 * 抖音商城 goods_detail：`img.url_list` 里前两条常为同一素材的 CDN 镜像（相同 jpeg_m_ 哈希），
 * 不能简单取 `url_list[1]` 当作「第二张商品图」。按素材指纹去重后，若有多个不同素材则取第二个；
 * 否则再试其它多图字段，最后整棵 JSON 收集 ecombdimg 打分兜底。
 */
function collectEcomImageUrlsFromUnknown(value: unknown, out: Set<string>, depth: number): void {
  if (depth > 14 || value === null || value === undefined) return;
  if (typeof value === "string") {
    if (!value.includes("ecombdimg.com")) return;
    let s = value;
    try {
      s = deeplyDecodeQueryValue(value);
    } catch {
      /* 保持原串 */
    }
    const re = /https:\/\/p\d+-item\.ecombdimg\.com\/img\/[^"'\s\\]+/gi;
    let m: RegExpExecArray | null;
    const copy = s;
    re.lastIndex = 0;
    while ((m = re.exec(copy)) !== null) out.add(m[0]);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => collectEcomImageUrlsFromUnknown(v, out, depth + 1));
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectEcomImageUrlsFromUnknown(v, out, depth + 1);
    }
  }
}

/** 路径里 www1500-1500 表示主图边长，越大越可能是高清商品平铺图 */
function parseMainSquareSideFromEcomUrl(url: string): number {
  const m = url.match(/www(\d+)-(\d+)/i);
  if (m) return Math.max(parseInt(m[1], 10) || 0, parseInt(m[2], 10) || 0);
  const m2 = url.match(/(\d{3,4})x(\d{3,4})/i);
  if (m2) return Math.max(parseInt(m2[1], 10) || 0, parseInt(m2[2], 10) || 0);
  return 0;
}

function scoreEcomProductStillImage(url: string): number {
  let score = 0;
  const lower = url.toLowerCase();
  if (lower.includes("ecom-shop-material")) score += 100;
  if (lower.includes("jpeg_m_") || lower.includes("png_m_")) score += 50;
  const side = parseMainSquareSideFromEcomUrl(url);
  if (side > 0) score += (side * side) / 10_000;
  if (/(video|live|avatar|thumbnail|cover_thumb|shop[-_]?logo|watermark)/i.test(url)) score -= 200;
  if (side > 0 && side < 200) score -= 40;
  return score;
}

function ecomImageDedupeKey(url: string): string {
  try {
    const u = new URL(url);
    let p = u.pathname;
    const tilde = p.indexOf("~");
    if (tilde >= 0) p = p.slice(0, tilde);
    return p.toLowerCase();
  } catch {
    return url;
  }
}

/** 商城素材指纹：`url_list` 里常见两条仅为 p26/p3 CDN 镜像，应用「第 2 张」时须按指纹去重 */
function ecomMaterialFingerprint(url: string): string {
  const m = url.match(/(?:jpeg|png)_m_([a-f0-9]+)/i);
  if (m?.[1]) return `m:${m[1].toLowerCase()}`;
  return `p:${ecomImageDedupeKey(url)}`;
}

/** 保持出现顺序，每种指纹只保留第一次出现的完整 URL */
function orderedDistinctEcomUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    let u = raw;
    try {
      u = deeplyDecodeQueryValue(raw);
    } catch {
      /* keep raw */
    }
    if (!/^https:\/\/p\d+-item\.ecombdimg\.com\//i.test(u)) continue;
    const fp = ecomMaterialFingerprint(u);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(u);
  }
  return out;
}

function pickBestEcomProductImage(urls: string[]): string | null {
  const decoded = urls
    .map((u) => {
      try {
        return deeplyDecodeQueryValue(u);
      } catch {
        return u;
      }
    })
    .filter((u) => /^https:\/\/p\d+-item\.ecombdimg\.com\//i.test(u));
  if (decoded.length === 0) return null;
  const byPath = new Map<string, { url: string; score: number }>();
  for (const url of decoded) {
    const key = ecomImageDedupeKey(url);
    const sc = scoreEcomProductStillImage(url);
    const prev = byPath.get(key);
    if (!prev || sc > prev.score) byPath.set(key, { url, score: sc });
  }
  let best: { url: string; score: number } | null = null;
  for (const v of byPath.values()) {
    if (!best || v.score > best.score) best = v;
  }
  return best?.url ?? null;
}

function safeDecodeEcomImageString(raw: unknown): string | null {
  try {
    const u = deeplyDecodeQueryValue(String(raw));
    if (u.startsWith("http") && /p\d+-item\.ecombdimg\.com\/img\//i.test(u)) return u;
  } catch {
    /* ignore */
  }
  return null;
}

/** 常见多图字段里取「第二张」用于识图（结构因商品而异） */
function trySecondImageFromProductArrays(obj: Record<string, unknown>): string | null {
  const keys = [
    "images",
    "pic_list",
    "pics",
    "banner_list",
    "product_images",
    "slider_pics",
    "detail_images",
    "sku_list",
  ];
  for (const k of keys) {
    const arr = obj[k];
    if (!Array.isArray(arr) || arr.length < 2) continue;
    const second = arr[1];
    if (typeof second === "string") {
      const u = safeDecodeEcomImageString(second);
      if (u) return u;
    }
    if (second && typeof second === "object") {
      const o = second as Record<string, unknown>;
      const ul = o.url_list;
      if (Array.isArray(ul) && ul.length > 0) {
        const decoded = ul
          .map((x) => safeDecodeEcomImageString(x))
          .filter((x): x is string => Boolean(x));
        const distinct = orderedDistinctEcomUrls(decoded);
        if (distinct.length >= 1) return distinct[0];
      }
      const url = o.url;
      if (typeof url === "string") {
        const u = safeDecodeEcomImageString(url);
        if (u) return u;
      }
      const uri = o.uri;
      if (typeof uri === "string" && String(uri).includes("ecom")) {
        const bag = new Set<string>();
        collectEcomImageUrlsFromUnknown(second, bag, 0);
        const picked = pickBestEcomProductImage([...bag]);
        if (picked) return picked;
      }
    }
  }
  return null;
}

/**
 * 优先 `img.url_list` 去重后的第二张**不同素材**；否则其它多图字段；最后全 JSON 收集打分。
 */
function extractBestImageFromGoodsDetailJsonString(jsonStr: string): string | null {
  try {
    const obj = JSON.parse(jsonStr) as Record<string, unknown>;
    const img = obj.img as { url_list?: string[] } | undefined;
    const list = img?.url_list;
    if (Array.isArray(list) && list.length >= 1) {
      const decoded = list
        .map((x) => safeDecodeEcomImageString(x))
        .filter((x): x is string => Boolean(x));
      const distinct = orderedDistinctEcomUrls(decoded);
      if (distinct.length >= 2) return distinct[1];
      if (distinct.length === 1) return distinct[0];
    }
    const fromArrays = trySecondImageFromProductArrays(obj);
    if (fromArrays) return fromArrays;
    const bag = new Set<string>();
    collectEcomImageUrlsFromUnknown(obj, bag, 0);
    return pickBestEcomProductImage([...bag]);
  } catch {
    return null;
  }
}

/** 从整段 HTML 里抠出 goods_detail= 参数（部分页面不把参数留在最终 location） */
function extractCommerceCoverFromHtmlParam(html: string): string | null {
  const m = html.match(/goods_detail=([^&"'<>\s]+)/i);
  if (!m?.[1]) return null;
  try {
    const jsonStr = deeplyDecodeQueryValue(m[1]);
    return extractBestImageFromGoodsDetailJsonString(jsonStr);
  } catch {
    return null;
  }
}

function extractCommerceCoverFromUrl(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    if (!u.hostname.toLowerCase().includes("jinritemai")) return null;
    const keys = ["goods_detail", "goodsDetail", "goods_detail_schema"];
    for (const k of keys) {
      const raw = u.searchParams.get(k);
      if (!raw) continue;
      let jsonStr: string;
      try {
        jsonStr = deeplyDecodeQueryValue(raw);
      } catch {
        continue;
      }
      const best = extractBestImageFromGoodsDetailJsonString(jsonStr);
      if (best) return best;
    }
  } catch {
    return null;
  }
  return null;
}

/** HTML 内嵌的商品图 CDN（部分 SSR / 内联数据） */
function extractEcomImageFromHtml(html: string): string | null {
  const re = /https:\/\/p\d+-item\.ecombdimg\.com\/img\/[^"'\\\s<>]+/gi;
  const all = [...html.matchAll(re)].map((x) => x[0]);
  if (all.length === 0) return null;
  const distinct = orderedDistinctEcomUrls(all);
  if (distinct.length >= 2) return distinct[1];
  return pickBestEcomProductImage(all);
}

function refererForImageDownload(imgUrl: string): string {
  try {
    return `${new URL(imgUrl).origin}/`;
  } catch {
    return "https://www.douyin.com/";
  }
}

function decodeDouyinEscapes(s: string): string {
  let u = s.replace(/\\u002F/gi, "/").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  if (u.startsWith("http")) return u;
  if (u.startsWith("//")) return `https:${u}`;
  return u;
}

function sendJson(res: ServerResponse, code: number, body: Record<string, unknown>) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function handlePreview(req: IncomingMessage, res: ServerResponse) {
  if (!req.url?.startsWith("/api/douyin-preview")) return false;
  try {
    const u = new URL(req.url, "http://vite.local");
    const rawParam = u.searchParams.get("url");
    if (!rawParam) {
      sendJson(res, 400, { error: "缺少 url 参数" });
      return true;
    }
    const decoded = decodeURIComponent(rawParam);
    const pageUrl = parsePageUrl(decoded);
    if (!pageUrl) {
      sendJson(res, 400, { error: "仅支持抖音域名（douyin.com / v.douyin.com 等）的 http(s) 链接" });
      return true;
    }

    const pageRes = await fetch(pageUrl.toString(), {
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
      signal: AbortSignal.timeout(25_000),
    });
    const html = await pageRes.text();
    if (!pageRes.ok) {
      sendJson(res, 502, { error: `拉取抖音页面失败（HTTP ${pageRes.status}）` });
      return true;
    }

    const finalUrl = typeof pageRes.url === "string" ? pageRes.url : pageUrl.toString();

    // 商城 goods_detail 必须在最前：否则 HTML 里 og:image / 其它首张图会盖住 url_list[1]
    const imgUrl =
      extractCommerceCoverFromUrl(finalUrl) ||
      extractCommerceCoverFromUrl(pageUrl.toString()) ||
      extractCommerceCoverFromHtmlParam(html) ||
      extractEcomImageFromHtml(html) ||
      extractCoverFromHtml(html);

    if (!imgUrl) {
      sendJson(res, 422, {
        error:
          "未能解析到商品/视频封面（商城页多为动态加载）。请改用相册上传商品图，或稍后再试。",
      });
      return true;
    }

    const referers = [
      refererForImageDownload(imgUrl),
      "https://haohuo.jinritemai.com/",
      "https://www.douyin.com/",
    ];
    let imgRes: Response | null = null;
    let lastImgStatus = 0;
    for (const ref of referers) {
      const ir = await fetch(imgUrl, {
        headers: {
          "User-Agent": UA,
          Referer: ref,
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(25_000),
      });
      lastImgStatus = ir.status;
      if (ir.ok) {
        imgRes = ir;
        break;
      }
    }
    if (!imgRes?.ok) {
      sendJson(res, 502, {
        error: `下载商品图失败（HTTP ${lastImgStatus}）。请稍后重试或改用相册上传。`,
      });
      return true;
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const ct = (imgRes.headers.get("content-type") || "image/jpeg").split(";")[0].trim() || "image/jpeg";
    const dataUrl = `data:${ct};base64,${buf.toString("base64")}`;
    sendJson(res, 200, { dataUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendJson(res, 500, { error: `解析失败：${msg}` });
  }
  return true;
}

/**
 * 开发服务器：同源 /api/douyin-preview 拉取抖音分享页并返回封面 data URL，避免浏览器 CORS。
 */
export function douyinPreviewPlugin(): Plugin {
  return {
    name: "douyin-preview-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handlePreview(req, res).then((handled) => {
          if (!handled) next();
        });
      });
    },
  };
}
