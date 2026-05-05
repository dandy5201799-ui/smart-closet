/** 去掉末尾误粘的标点、中文等（商城分享常在短链后紧跟「商品标题」无空格） */
function clipInvalidUrlSuffix(url: string): string {
  let out = url.trim().replace(/\u200b|\ufeff/g, "");
  out = out.replace(/[),.;，。、！？;:"'»」』\]\)]+$/g, "");
  while (out.length > 0) {
    const ch = out[out.length - 1];
    if (/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%\-/]/.test(ch)) break;
    out = out.slice(0, -1);
  }
  return out.replace(/\/+$/, "") || out;
}

/**
 * 从用户粘贴的整段抖音分享文案中提取链接（支持短链 v.douyin.com、视频页、商城分享等）。
 * 例：「2.84 yGi:/ … 【抖音商城】https://v.douyin.com/FdGh8vcIxHk/ 赫库森…」→ 只取短链部分。
 */
export function extractDouyinUrlFromText(text: string): string | null {
  const s = text.replace(/\u200b|\ufeff/g, "").trim();

  // 短链：路径一般为字母数字，避免旧正则把后面的中文标题吃进 URL
  const short = s.match(/https?:\/\/v\.douyin\.com\/[A-Za-z0-9_-]+(?:\?[^\s]*)?\/?/i);
  if (short?.[0]) {
    return clipInvalidUrlSuffix(short[0]);
  }

  const video = s.match(/https?:\/\/(?:[wm]\.)?(?:www\.)?douyin\.com\/video\/\d+/i);
  if (video?.[0]) return clipInvalidUrlSuffix(video[0]);

  const note = s.match(/https?:\/\/(?:[wm]\.)?(?:www\.)?douyin\.com\/note\/\d+/i);
  if (note?.[0]) return clipInvalidUrlSuffix(note[0]);

  const loose = s.match(
    /https?:\/\/(?:[vwm]\.)?(?:www\.)?(?:ies\d*\.)?douyin\.com\/[^\s"'<>，。；、]+/i
  );
  if (loose?.[0]) {
    return clipInvalidUrlSuffix(loose[0]);
  }

  try {
    const u = new URL(s);
    const h = u.hostname.toLowerCase();
    if (
      (h === "douyin.com" || h.endsWith(".douyin.com") || h === "iesdouyin.com" || h.endsWith(".iesdouyin.com")) &&
      (u.protocol === "http:" || u.protocol === "https:")
    ) {
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return null;
}

function dedupeUrlKey(url: string): string {
  try {
    const u = new URL(url.trim());
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.hostname.toLowerCase()}${path}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * 从一大段文本中收集多条抖音链接（去重、保序）。
 * 支持：每行一段分享文案、一行内多条短链、空行分隔等。
 */
export function extractAllDouyinUrlsFromText(blob: string): string[] {
  const raw = blob.replace(/\u200b|\ufeff/g, "");
  const seen = new Set<string>();
  const ordered: string[] = [];

  const add = (candidate: string | null | undefined) => {
    if (!candidate) return;
    const u = candidate.trim();
    if (!u) return;
    const key = dedupeUrlKey(u);
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(u);
  };

  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (t) add(extractDouyinUrlFromText(t));
  }

  const scanPatterns = [
    /https?:\/\/v\.douyin\.com\/[A-Za-z0-9_-]+(?:\?[^\s]*)?\/?/gi,
    /https?:\/\/(?:[wm]\.)?(?:www\.)?douyin\.com\/video\/\d+/gi,
    /https?:\/\/(?:[wm]\.)?(?:www\.)?douyin\.com\/note\/\d+/gi,
    /https?:\/\/(?:[vwm]\.)?(?:www\.)?(?:ies\d*\.)?douyin\.com\/[^\s"'<>，。；、]+/gi,
  ];
  for (const re of scanPatterns) {
    const ms = raw.matchAll(re);
    for (const m of ms) {
      if (m[0]) add(extractDouyinUrlFromText(m[0]));
    }
  }

  return ordered;
}

function previewApiBase(): string {
  const custom = String(import.meta.env.VITE_DOUYIN_PREVIEW_URL ?? "").trim().replace(/\/$/, "");
  return custom;
}

/**
 * 对已提取的一条抖音 URL 请求预览接口，返回封面 data URL。
 */
export async function fetchDouyinCoverForUrl(canonicalUrl: string): Promise<string> {
  const base = previewApiBase();
  const path = `/api/douyin-preview?url=${encodeURIComponent(canonicalUrl)}`;
  const endpoint = base ? `${base}${path}` : path;
  const r = await fetch(endpoint);
  if (r.status === 404) {
    throw new Error(
      "当前环境没有抖音解析接口：请使用 npm run dev 本地运行，或在 .env 中配置 VITE_DOUYIN_PREVIEW_URL 指向你的网关（需实现 GET /api/douyin-preview?url=）。"
    );
  }
  let j: { dataUrl?: string; error?: string };
  try {
    j = (await r.json()) as { dataUrl?: string; error?: string };
  } catch {
    throw new Error(`解析接口返回非 JSON（HTTP ${r.status}）`);
  }
  if (!r.ok || !j.dataUrl) {
    throw new Error(j.error || `解析失败（HTTP ${r.status}）`);
  }
  return j.dataUrl;
}

/**
 * 从粘贴文案中提取首条链接并请求封面（单条场景）。
 */
export async function fetchDouyinCoverAsDataUrl(paste: string): Promise<string> {
  const url = extractDouyinUrlFromText(paste);
  if (!url) {
    throw new Error("未识别到抖音链接，请粘贴含 douyin.com 或 v.douyin.com 的分享地址");
  }
  return fetchDouyinCoverForUrl(url);
}
