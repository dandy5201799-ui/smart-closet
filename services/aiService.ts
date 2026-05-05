import type { AnalyzedItem, Outfit, OutfitSuggestion, WardrobeItem } from "../types";
import {
  analyzeClothingImageWithKimi,
  generateOutfitSuggestionWithKimi,
  hasKimiApiKey,
} from "./kimiService";
import type { OutfitWeatherPromptContext } from "./outfitWeatherContext";
import { generateOutfitImageWithSeedream, hasArkApiKey } from "./volcengineSeedreamService";

/** 衣服识别：仅 Kimi */
export const analyzeClothingImage = async (base64Image: string): Promise<AnalyzedItem> => {
  if (!hasKimiApiKey()) {
    throw new Error(
      "未配置 KIMI_API_KEY：请在 .env 中填写 KIMI_API_KEY 或 MOONSHOT_API_KEY（见 .env.example），保存后重新执行 npm run dev。"
    );
  }
  return analyzeClothingImageWithKimi(base64Image);
};

/** AI 搭配：仅 Kimi */
export const generateOutfitSuggestion = async (
  wardrobe: WardrobeItem[],
  focusItemIds?: string[],
  existingOutfits?: Outfit[],
  weatherContext?: OutfitWeatherPromptContext | null
): Promise<OutfitSuggestion> => {
  if (!hasKimiApiKey()) {
    throw new Error(
      "未配置 KIMI_API_KEY：搭配功能需要 Kimi，请在 .env 中配置后重启 npm run dev。"
    );
  }
  return generateOutfitSuggestionWithKimi(wardrobe, focusItemIds, existingOutfits, weatherContext);
};

/** 模特上身图：仅火山方舟 Seedream（失败或异常响应会 throw，不再静默返回 null） */
export const generateOutfitImage = async (items: WardrobeItem[]): Promise<string> => {
  if (!hasArkApiKey()) {
    throw new Error(
      "未配置 ARK_API_KEY：模特图需要火山方舟，请在 .env 中填写 ARK_API_KEY（见 .env.example），保存后重新执行 npm run dev。"
    );
  }
  return generateOutfitImageWithSeedream(items);
};
