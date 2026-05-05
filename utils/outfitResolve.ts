import type { WardrobeItem } from "../types";

/**
 * 按搭配方案中的 id 顺序解析衣橱单品（与 `items` 数组在内存中的顺序无关）。
 */
export function resolveWardrobeItemsByOutfitIds(
  itemIds: string[],
  wardrobe: WardrobeItem[]
): WardrobeItem[] {
  const byId = new Map(wardrobe.map((i) => [i.id, i]));
  const out: WardrobeItem[] = [];
  const seen = new Set<string>();
  for (const id of itemIds) {
    if (seen.has(id)) continue;
    const item = byId.get(id);
    if (item) {
      seen.add(id);
      out.push(item);
    }
  }
  return out;
}

/** 用于上身参考图顺序：连衣裙 → 上装 → 下装 → 外套 → 配饰 → 其它；同档保持输入相对顺序 */
function tryOnCategoryRank(category: string): number {
  const c = category || "";
  if (c.includes("连衣裙")) return 0;
  if (c.includes("上装") || c.includes("上衣") || c.includes("衬衫") || c.includes("T恤")) return 1;
  if (c.includes("下装") || c.includes("裤") || c.includes("裙") && !c.includes("连衣")) return 2;
  if (c.includes("外套") || c.includes("夹克") || c.includes("大衣")) return 3;
  if (c.includes("配饰") || c.includes("鞋") || c.includes("包") || c.includes("帽")) return 4;
  return 10;
}

export function orderItemsForTryOnRender(items: WardrobeItem[]): WardrobeItem[] {
  return [...items]
    .map((item, index) => ({ item, index, rank: tryOnCategoryRank(item.category) }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
