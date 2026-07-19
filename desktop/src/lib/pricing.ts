// Editable per-model pricing, in USD per 1M tokens (input / output).
//
// Seeded with a few common cloud models; extend this table as needed. Local and
// unknown models cost $0 — the panel then shows tokens + tokens/sec instead of a
// dollar figure. Prices are indicative and change often; treat as an estimate.

export interface ModelPrice {
  /** USD per 1M input (prompt) tokens. */
  input_per_1m: number;
  /** USD per 1M output (completion) tokens. */
  output_per_1m: number;
}

export const PRICING: Record<string, ModelPrice> = {
  "gpt-4o-mini": { input_per_1m: 0.15, output_per_1m: 0.6 },
  "gpt-4o": { input_per_1m: 2.5, output_per_1m: 10 },
  "claude-sonnet-5": { input_per_1m: 3, output_per_1m: 15 },
  "claude-haiku-4-5": { input_per_1m: 1, output_per_1m: 5 },
  "claude-opus-4-8": { input_per_1m: 15, output_per_1m: 75 },
  // local engines and anything unpriced → free
  local: { input_per_1m: 0, output_per_1m: 0 },
};

/** Look up a model's price. Returns null for a model not in the table (so the
 *  UI can say "pricing unknown" instead of a misleading $0). `local` is priced $0. */
export function priceFor(model: string): ModelPrice | null {
  return PRICING[model] ?? null;
}

/** Estimated USD cost for a call, or null when the model's price is unknown
 *  (unlisted cloud model / custom endpoint). `local` returns 0. */
export function costUsd(model: string, inTok: number, outTok: number): number | null {
  const p = priceFor(model);
  if (!p) return null;
  return (inTok / 1_000_000) * p.input_per_1m + (outTok / 1_000_000) * p.output_per_1m;
}
