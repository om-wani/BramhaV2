/**
 * Token count estimation.
 *
 * Uses a conservative 4-chars-per-token approximation suitable for English
 * prose. Full tiktoken integration comes in T3.1.1.
 */

/**
 * Estimate the number of tokens in a string.
 * Assumes ~4 characters per token (conservative for English text).
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}
