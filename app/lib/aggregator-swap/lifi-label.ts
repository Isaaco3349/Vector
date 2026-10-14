/** Human-readable LI.FI bridge/swap tool (often Uniswap, Morpho, etc. on Arc). */
export function readLifiToolLabel(quote: unknown): string | null {
  if (!quote || typeof quote !== "object") return null;
  const q = quote as Record<string, unknown>;
  const toolDetails = q.toolDetails;
  if (toolDetails && typeof toolDetails === "object") {
    const name = (toolDetails as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  const estimate = q.estimate;
  if (estimate && typeof estimate === "object") {
    const tool = (estimate as { tool?: unknown }).tool;
    if (typeof tool === "string" && tool.trim()) return tool.trim();
  }
  if (typeof q.tool === "string" && q.tool.trim()) return q.tool.trim();
  return null;
}

export function formatLifiOfferLabel(quote: unknown): {
  label: string;
  sublabel: string | null;
} {
  const tool = readLifiToolLabel(quote);
  return {
    label: "LI.FI",
    sublabel: tool ? `via ${tool}` : "Arc aggregator (may route Uniswap pools)",
  };
}
