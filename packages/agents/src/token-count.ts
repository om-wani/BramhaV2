/**
 * Token count estimation.
 *
 * Uses a conservative 4-chars-per-token approximation suitable for English
 * prose. Full tiktoken integration comes in T3.1.1.
 */

/**
 * Estimate the number of tokens in a string.
 * Assumes ~4 characters per token (conservative for English text).
 * Underestimates for code files (~1.5–2× actual tokens). Replace with tiktoken in T3.1.1.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}
