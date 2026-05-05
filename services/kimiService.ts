import type { AnalyzedItem, Outfit, OutfitSuggestion, WardrobeItem } from "../types";
import { shrinkBase64 } from "../utils/imageUtils";
import { safeJsonParse } from "./aiJsonUtils";
import { deriveOutfitClimateLabels, type OutfitWeatherPromptContext } from "./outfitWeatherContext";

const pickKimiKey = (): string => {
  const a = String(process.env.KIMI_API_KEY ?? "").trim();
  const b = String(process.env.MOONSHOT_API_KEY ?? "").trim();
  return a || b;
};

const getKimiApiKey = (): string => {
  const key = pickKimiKey();
  if (!key) {
    throw new Error(
      "未配置 KIMI_API_KEY：请在 .env 中填写 KIMI_API_KEY 或 MOONSHOT_API_KEY 后重新执行 npm run dev。"
    );
  }
  return key.trim();
};

const getKimiModel = (): string => {
  const m = process.env.KIMI_MODEL;
  return m && m.trim() ? m.trim() : "kimi-k2.6";
};

const normalizeDataUrl = (base64Image: string): string => {
  if (/^data:image\//i.test(base64Image)) return base64Image;
  return `data:image/jpeg;base64,${base64Image.replace(/^data:image\/\w+;base64,/i, "")}`;
};

/**
 * 国内 platform.moonshot.cn → api.moonshot.cn；国际 platform.kimi.ai → api.moonshot.ai。
 * 未设置 KIMI_MOONSHOT_HOST 时默认先国内、再国际（401/403 时自动换端重试）。
 */
const getKimiChatUrls = (): string[] => {
  const custom = String(process.env.KIMI_API_BASE ?? "").trim();
  if (custom) {
    return [`${custom.replace(/\/$/, "")}/v1/chat/completions`];
  }
  const hostPref = String(process.env.KIMI_MOONSHOT_HOST ?? "").trim().toLowerCase();
  if (import.meta.env.DEV) {
    if (hostPref === "cn") return ["/kimi-moonshot-cn/v1/chat/completions"];
    if (hostPref === "ai") return ["/kimi-moonshot/v1/chat/completions"];
    return ["/kimi-moonshot-cn/v1/chat/completions", "/kimi-moonshot/v1/chat/completions"];
  }
  if (hostPref === "cn") return ["https://api.moonshot.cn/v1/chat/completions"];
  if (hostPref === "ai") return ["https://api.moonshot.ai/v1/chat/completions"];
  return [
    "https://api.moonshot.cn/v1/chat/completions",
    "https://api.moonshot.ai/v1/chat/completions",
  ];
};

async function kimiPostChat(apiKey: string, body: Record<string, unknown>): Promise<Response> {
  const urls = getKimiChatUrls();
  let last: Response | null = null;
  let lastNet: Error | null = null;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      last = res;
      if (res.ok) return res;
      const retry = (res.status === 401 || res.status === 403) && i < urls.length - 1;
      if (!retry) return res;
    } catch (e) {
      lastNet = e instanceof Error ? e : new Error(String(e));
      if (i === urls.length - 1) break;
    }
  }

  if (lastNet && !last) {
    const hint = import.meta.env.DEV
      ? "请用 npm run dev 打开 localhost，不要用 file://。若仍失败，检查网络或 VPN。"
      : "预览/线上请设置 KIMI_API_BASE 为可访问的代理地址。";
    throw new Error(`无法连接 Kimi：${lastNet.message}。${hint}`);
  }
  return last!;
}

/**
 * 使用 Kimi（Moonshot）视觉模型识别服装图。
 * @see https://platform.kimi.ai/docs/guide/use-kimi-vision-model
 */
export const analyzeClothingImageWithKimi = async (base64Image: string): Promise<AnalyzedItem> => {
  const apiKey = getKimiApiKey();
  const model = getKimiModel();
  const shrunk = await shrinkBase64(base64Image, 1024);
  const imageUrl = normalizeDataUrl(shrunk);

  const systemPrompt =
    "你是服装图像分析助手，只输出合法 JSON 对象，不要 markdown 代码块，不要其它说明文字。";
  const userText = `分析此服装图片，返回一个 JSON 对象，字段如下（全部为字符串）：
name：简短名称
category：只能是 上装 / 下装 / 裙装 / 外套 / 鞋包 之一
color：主要颜色（中文）
style：只能是 休闲 / 商务 / 复古 / 街头 之一
material：只能是 棉麻 / 牛仔 / 丝绸 / 羊绒 之一（若不明显则选最接近的）
occasion：只能是 通勤 / 约会 / 运动 / 晚宴 之一
description：一两句中文描述`;

  // 视觉多模态下部分账号对 response_format=json_object 会 400，改由提示词约束 JSON
  const res = await kimiPostChat(apiKey, {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageUrl } },
          { type: "text", text: userText },
        ],
      },
    ],
  });

  const raw = await res.text();
  let data: { error?: { message?: string }; choices?: { message?: { content?: string } }[] };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error(`Kimi 接口返回非 JSON（HTTP ${res.status}）：${raw.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg = data.error?.message || raw.slice(0, 300);
    throw new Error(
      `Kimi 识图失败（${res.status}）：${msg}。国内站密钥请确认 .env 中 KIMI_MOONSHOT_HOST=cn（或不写，默认先走国内）。国际站密钥请设 KIMI_MOONSHOT_HOST=ai。`
    );
  }

  const text = data.choices?.[0]?.message?.content;
  const parsed = safeJsonParse(text) as unknown as AnalyzedItem;
  if (!parsed || typeof parsed.name !== "string") {
    throw new Error("Kimi 返回内容无法解析为服装 JSON，请重试或检查模型是否支持视觉");
  }
  return parsed;
};

export const hasKimiApiKey = (): boolean => Boolean(pickKimiKey());

/**
 * 使用 Kimi 文本模型生成搭配方案（JSON）。
 */
export const generateOutfitSuggestionWithKimi = async (
  wardrobe: WardrobeItem[],
  focusItemIds?: string[],
  existingOutfits?: Outfit[],
  weatherContext?: OutfitWeatherPromptContext | null
): Promise<OutfitSuggestion> => {
  const apiKey = getKimiApiKey();
  const model = getKimiModel();
  const inventory = wardrobe.map((i) => ({
    id: i.id,
    name: i.name,
    category: i.category,
    style: i.style,
    color: i.color,
  }));

  const historyContext =
    existingOutfits && existingOutfits.length > 0
      ? `不要推荐与下列标题重复或过于相似的方案：${existingOutfits
          .slice(0, 5)
          .map((o) => o.title)
          .join("；")}`
      : "";

  const weatherSection = weatherContext
    ? `## 今日场景与天气（须纳入搭配决策）
${weatherContext.headline}
${weatherContext.detail}
请结合上述信息选择单品薄厚、是否适合当天气温与晴雨、防风与防雨；在 reason 中用一两句话明确写出对「今日天气与地点」的考量（勿编造未给出的气象数据）。
`
    : `## 今日场景与天气
未获取到实时天气与精确地点，请按公历季节与通用通勤、日常外出场景选择合适薄厚与风格；在 reason 中可简要说明按季节与通用场景的考量。
`;

  const userText = `你是一位高级时装搭配师。
任务：从下面衣橱 JSON 清单中挑选 2～4 件单品 id，组成一套搭配。
要求：
1）${focusItemIds && focusItemIds.length > 0 ? `必须包含单品 id（原样复制，不可改）：${focusItemIds.join("、")}` : "可自由组合"}
2）${historyContext || "注意单品之间风格、色系统一"}
3）风格鲜明，适合日常或场景化穿着
4）itemIds 中的每一项必须**完全等于**清单里某个对象的 id 字段（原样字符串），禁止编造清单中不存在的 id。
5）若能组成合理穿搭：优先「上装 + 下装」；若有连衣裙可作主件则可用连衣裙配外套/配饰；避免整套只有鞋包帽等配饰而无上衣/下装或连衣裙（除非清单里确实没有上装、下装、连衣裙可搭）。

${weatherSection}
衣橱清单：${JSON.stringify(inventory)}

只输出一个 JSON 对象（不要 markdown），字段严格为：
{"itemIds": string[], "title": string, "reason": string, "suitableTempRange": string, "suitableWeather": string}
其中 itemIds 为所选单品的 id 数组（顺序表示搭配主次，建议上装或连衣裙在前、下装其次）。
suitableTempRange：用简短中文写出本套搭配**适宜穿着的体感温度范围**（如「约 18°C～26°C」或「10°C～16°C 建议叠穿」），须与上文天气/季节逻辑一致。
suitableWeather：用简短中文写出**适宜的天气或室外条件**（如「晴、微风」「阵雨时需外套防雨」）；若无实时天气段则填「春秋通用·通勤」类说明。`;

  const res = await kimiPostChat(apiKey, {
    model,
    messages: [
      {
        role: "system",
        content:
          "你只输出合法 JSON 对象，不要代码块或其它说明。字段必须包含 itemIds、title、reason、suitableTempRange、suitableWeather。",
      },
      { role: "user", content: userText },
    ],
    response_format: { type: "json_object" },
  });

  const raw = await res.text();
  let data: { error?: { message?: string }; choices?: { message?: { content?: string } }[] };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error(`Kimi 接口返回非 JSON（HTTP ${res.status}）`);
  }

  if (!res.ok) {
    const msg = data.error?.message || raw.slice(0, 200);
    throw new Error(`Kimi 搭配失败（${res.status}）：${msg}`);
  }

  const text = data.choices?.[0]?.message?.content;
  const parsed = safeJsonParse(text) as Record<string, unknown>;
  const pickStr = (...keys: string[]): string => {
    for (const k of keys) {
      const v = parsed[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };

  const itemIds = parsed.itemIds;
  const title = parsed.title;
  const reason = parsed.reason;
  let suitableTempRange = pickStr("suitableTempRange", "suitable_temp_range");
  let suitableWeather = pickStr("suitableWeather", "suitable_weather");
  if (!Array.isArray(itemIds) || typeof title !== "string" || typeof reason !== "string") {
    throw new Error("Kimi 返回的搭配 JSON 格式不正确，请重试");
  }
  if (weatherContext) {
    const derived = deriveOutfitClimateLabels(weatherContext);
    if (!suitableTempRange) suitableTempRange = derived.suitableTempRange;
    if (!suitableWeather) suitableWeather = derived.suitableWeather;
  }
  if (!suitableTempRange) suitableTempRange = "按季节与体感通用";
  if (!suitableWeather) suitableWeather = "未获取实时天气，通用通勤场景";

  const validIds = new Set(wardrobe.map((w) => w.id));
  const cleaned = itemIds.map(String).filter((id) => validIds.has(id));
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of cleaned) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  if (unique.length < 2) {
    throw new Error(
      "Kimi 返回的单品 id 不在当前衣橱或不足 2 件，无法组成搭配。请重试「生成搭配」。"
    );
  }
  const requiredFocus = (focusItemIds ?? []).map(String).filter((id) => validIds.has(id));
  for (const id of requiredFocus) {
    if (!unique.includes(id)) {
      throw new Error("Kimi 未包含你指定的必选单品，请重试「生成搭配」。");
    }
  }

  return {
    itemIds: unique,
    title,
    reason,
    suitableTempRange,
    suitableWeather,
  };
};
