import type { WardrobeItem } from "../types";
import { orderItemsForTryOnRender } from "../utils/outfitResolve";
import { shrinkBase64 } from "../utils/imageUtils";

const DEFAULT_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const DEFAULT_MODEL = "doubao-seedream-5-0-260128";

/** 生图接口可能排队较久，但无超时会让界面一直转圈；超时后用户可重试或检查网络 */
const SEEDREAM_POST_TIMEOUT_MS = 180_000;
const SEEDREAM_IMAGE_DOWNLOAD_TIMEOUT_MS = 120_000;

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const c = new AbortController();
  const t = window.setTimeout(() => c.abort(), ms);
  return {
    signal: c.signal,
    cancel: () => clearTimeout(t),
  };
}

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  if (e instanceof Error && e.name === "AbortError") return true;
  return false;
}

/** 大图用字符串拼接 + btoa 会卡死主线程；FileReader 由浏览器高效处理 */
function arrayBufferToDataUrl(buf: ArrayBuffer, mimeHint: string): Promise<string> {
  const mime = (mimeHint.split(";")[0] || "image/png").trim() || "image/png";
  const blob = new Blob([buf], { type: mime });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === "string") resolve(r);
      else reject(new Error("读取图片数据失败"));
    };
    reader.onerror = () => reject(new Error("读取图片数据失败"));
    reader.readAsDataURL(blob);
  });
}

export const hasArkApiKey = (): boolean =>
  Boolean(String(process.env.ARK_API_KEY ?? "").trim());

const getArkApiKey = (): string => {
  const key = String(process.env.ARK_API_KEY ?? "").trim();
  if (!key) {
    throw new Error(
      "未配置 ARK_API_KEY：请在 .env 中填写火山方舟 API Key（见 .env.example），保存后重新执行 npm run dev。"
    );
  }
  return key;
};

const getEndpoint = (): string => {
  const custom = String(process.env.ARK_IMAGE_ENDPOINT ?? "").trim();
  if (custom) return custom;
  // 开发环境默认走 Vite 代理（见 vite.config server.proxy）；生产可设 ARK_IMAGE_ENDPOINT 为自有网关
  if (import.meta.env.DEV) {
    return "/volcengine-ark/images/generations";
  }
  return DEFAULT_ENDPOINT;
};

const getModel = (): string => {
  const m = String(process.env.ARK_IMAGE_MODEL ?? "").trim();
  return m || DEFAULT_MODEL;
};

/** 参考图数量上限（与 Kimi 搭配 2～4 件对齐；可在 .env 用 ARK_OUTFIT_MAX_REF_IMAGES 调整，最高 10） */
function getMaxOutfitRefImages(): number {
  const raw = Number.parseInt(String(process.env.ARK_OUTFIT_MAX_REF_IMAGES ?? "").trim(), 10);
  if (Number.isFinite(raw) && raw >= 1) return Math.min(raw, 10);
  return 4;
}

function buildOutfitTryOnPrompt(ordered: WardrobeItem[]): string {
  const n = ordered.length;
  const catalog = ordered
    .map((i, idx) => `第${idx + 1}张：「${i.name}」（品类：${i.category}；主色：${i.color}）`)
    .join("；");
  const multiPiece =
    n >= 3
      ? `\n若参考图不少于 3 张：成片中须**同时清晰可见至少 3 件**所选单品的颜色与款式（例如上装、下装与外套/配饰/鞋之一均勿被完全遮挡或裁切掉），禁止只明显呈现其中 2 件而第 3 件消失或无法辨认。`
      : "";
  return `共有 ${n} 张服装参考图，按顺序依次为：${catalog}。

请生成一位东亚面孔的专业模特，**同时穿着上述全部 ${n} 件单品**，款式、颜色、版型与参考图一致、整体协调为一套完整穿搭。${multiPiece}
高端时尚杂志摄影风格，真实面料质感，影棚柔光，干净浅色背景，全身或半身竖构图，商业大片质感。`;
}

/**
 * 使用火山方舟 Seedream 根据衣橱单品参考图生成模特上身图。
 * @see https://www.volcengine.com/docs/82379/1541523
 */
export const generateOutfitImageWithSeedream = async (items: WardrobeItem[]): Promise<string> => {
  const apiKey = getArkApiKey();
  const url = getEndpoint();
  const model = getModel();

  const ordered = orderItemsForTryOnRender(items);
  const maxRef = getMaxOutfitRefImages();
  const limited = ordered.slice(0, maxRef);
  if (limited.length === 0) {
    throw new Error(
      "当前搭配里没有可用的单品图（id 可能已失效或未同步），无法请求生图。请重新生成搭配或重新录入单品。"
    );
  }
  const refImages: string[] = await Promise.all(
    limited.map(async (i) => shrinkBase64(i.imageUrl, 768))
  );

  const prompt = buildOutfitTryOnPrompt(limited);

  const postTimer = withTimeout(SEEDREAM_POST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: postTimer.signal,
      body: JSON.stringify({
        model,
        prompt,
        image: refImages.length === 1 ? refImages[0] : refImages,
        size: "2K",
        response_format: "b64_json",
        watermark: false,
      }),
    });
  } catch (e) {
    if (isAbortError(e)) {
      throw new Error(
        `火山生图请求超过 ${SEEDREAM_POST_TIMEOUT_MS / 1000} 秒未返回，已自动中断（多为网络或网关阻塞）。请检查网络、代理或稍后在详情页重试。`
      );
    }
    const hint = import.meta.env.DEV
      ? "请用 npm run dev 访问 localhost；不要用 file://。"
      : "请设置 ARK_IMAGE_ENDPOINT 为可访问的网关。";
    throw new Error(`无法请求火山生图：${e instanceof Error ? e.message : String(e)}。${hint}`);
  } finally {
    postTimer.cancel();
  }

  const raw = await res.text();
  let data: {
    data?: { b64_json?: string; url?: string }[];
    error?: { code?: string; message?: string };
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error(`火山图片接口返回非 JSON（HTTP ${res.status}）`);
  }

  if (!res.ok) {
    const msg = data.error?.message ?? raw.slice(0, 300);
    throw new Error(`火山 Seedream 生成失败（${res.status}）：${msg}`);
  }

  const b64 = data.data?.[0]?.b64_json;
  if (b64) {
    return `data:image/png;base64,${b64}`;
  }

  const imageUrl = data.data?.[0]?.url;
  if (imageUrl) {
    const dlTimer = withTimeout(SEEDREAM_IMAGE_DOWNLOAD_TIMEOUT_MS);
    let imgRes: Response;
    try {
      imgRes = await fetch(imageUrl, { signal: dlTimer.signal });
    } catch (e) {
      if (isAbortError(e)) {
        throw new Error("下载火山返回的图片超时，请重试。");
      }
      throw e;
    } finally {
      dlTimer.cancel();
    }
    if (!imgRes.ok) {
      throw new Error("火山返回的图片地址无法下载");
    }
    const buf = await imgRes.arrayBuffer();
    const ct = imgRes.headers.get("content-type") || "image/png";
    return arrayBufferToDataUrl(buf, ct);
  }

  throw new Error(
    `火山接口返回 200 但未包含图片（无 b64_json/url）。请核对 ARK_IMAGE_MODEL 是否支持图生图，或查看控制台网络响应。片段：${raw.slice(0, 280)}`
  );
};
