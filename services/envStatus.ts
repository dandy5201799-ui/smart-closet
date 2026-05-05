import { hasKimiApiKey } from "./kimiService";
import { hasArkApiKey } from "./volcengineSeedreamService";

export { hasKimiApiKey } from "./kimiService";

/** 火山 Seedream 模特图 */
export const canGenerateOutfitImage = (): boolean => hasArkApiKey();

export type ApiSetupStatus = {
  canRecognizeClothes: boolean;
  warnings: string[];
};

export const getApiSetupStatus = (): ApiSetupStatus => {
  const kimi = hasKimiApiKey();
  const ark = hasArkApiKey();
  const warnings: string[] = [];

  if (!kimi) {
    warnings.push(
      "尚未配置 Kimi：将 .env.example 复制为 .env，填写 KIMI_API_KEY 或 MOONSHOT_API_KEY（识图与搭配均需要），保存后重新执行 npm run dev。"
    );
  }
  if (!ark) {
    warnings.push(
      "尚未配置火山方舟：在 .env 中填写 ARK_API_KEY 后可使用「模特上身图」（Seedream）。"
    );
  }

  return {
    canRecognizeClothes: kimi,
    warnings,
  };
};
