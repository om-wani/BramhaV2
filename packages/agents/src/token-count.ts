/**
 * Token count estimation.
 *
 * Tries to use tiktoken (cl100k_base) if available; falls back to a
 * conservative 4-chars-per-token approximation. Tiktoken is NOT a hard
 * dependency — it's a large WASM binary; callers that can tolerate a ~25%
 * estimate should not block on it.
 *
 * Dynamic import is used so that the WASM module is loaded lazily and does
 * not bloat startup time for processes that don't use it.
 */

// ── Tiktoken bootstrap (lazy, optional) ───────────────────────────────────────

type TiktokenEncoder = {
  encode(text: string): Uint32Array
  free(): void
}

let encoder: TiktokenEncoder | null = null
let tiktokenResolved = false

async function getTiktoken(): Promise<TiktokenEncoder | null> {
  if (tiktokenResolved) return encoder

  try {
    // tiktoken is an optional peer dependency; do NOT add to package.json.
    // Cast to `string` so TypeScript does not attempt static module resolution —
    // the import only resolves at runtime and fails gracefully if not installed.
    const mod = await import('tiktoken' as string) as { get_encoding: (enc: string) => TiktokenEncoder }
    encoder = mod.get_encoding('cl100k_base')
  } catch {
    // Package not installed or WASM failed to load — fall back to heuristic
    encoder = null
  }

  tiktokenResolved = true
  return encoder
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Estimate the number of tokens in a string.
 *
 * If tiktoken is available in the current environment, delegates to it
 * (accurate for cl100k_base models like GPT-4, Claude, etc.).
 *
 * Falls back to `Math.ceil(text.length / 4)` — conservative for English prose,
 * underestimates code by ~1.5–2×.
 *
 * @param text - The input text to tokenise
 * @param useTiktoken - If false, always use the heuristic (default: true)
 */
export async function estimateTokenCountAsync(
  text: string,
  useTiktoken = true,
): Promise<number> {
  if (useTiktoken) {
    const enc = await getTiktoken()
    if (enc) {
      return enc.encode(text).length
    }
  }
  return Math.ceil(text.length / 4)
}

/**
 * Synchronous fallback — always uses the 4-chars-per-token heuristic.
 *
 * Use this in hot paths where async is not appropriate (e.g. batch sizing).
 * Prefer `estimateTokenCountAsync` where accuracy matters.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}
