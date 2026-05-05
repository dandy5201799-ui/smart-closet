/**
 * Parse JSON from LLM text (strip markdown fences, recover single object).
 */
export const safeJsonParse = (text: string | undefined): Record<string, unknown> => {
  if (!text || text.trim() === "") return {};
  try {
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    if (!text) return {};
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return {};
  }
};
