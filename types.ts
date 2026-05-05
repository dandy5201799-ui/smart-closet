
export enum AppState {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  WARDROBE = 'WARDROBE',
  ITEM_DETAIL = 'ITEM_DETAIL',
  EDITING_CROP = 'EDITING_CROP',
  OUTFIT_GENERATION = 'OUTFIT_GENERATION',
  ERROR = 'ERROR'
}

export interface AnalyzedItem {
  name: string;
  category: string;
  color: string;
  style: string;
  material: string;
  occasion: string;
  description: string;
}

export interface WardrobeItem extends AnalyzedItem {
  id: string;
  imageUrl: string; // Base64 of the processed transparent image
  createdAt: number;
  /** 已展示图片，Kimi 识图尚未完成 */
  analysisPending?: boolean;
  /** 若从抖音分享链接录入，保存原始链接便于回看 */
  douyinSourceUrl?: string;
}

export interface Outfit {
  id: string;
  itemIds: string[];
  title: string;
  reason: string;
  generatedImageUrl?: string; // The AI composed image of the outfit
  createdAt: number;
  /** 适宜体感温度带（如「约 18°C～26°C」），生成搭配时写入 */
  suitableTempRange?: string;
  /** 适宜天气/场景简述（如「晴、微风」），生成搭配时写入 */
  suitableWeather?: string;
}

/** Kimi「生成搭配」解析后的字段（含气候标签，写入 Outfit） */
export interface OutfitSuggestion {
  itemIds: string[];
  title: string;
  reason: string;
  suitableTempRange: string;
  suitableWeather: string;
}

export enum ClothingType {
  TOP = '上装',
  BOTTOM = '下装',
  DRESS = '连衣裙',
  OUTERWEAR = '外套',
  ACCESSORY = '配饰'
}
