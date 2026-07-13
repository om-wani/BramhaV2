/** Parse a raw Cookie header into a key→value map. */
export function parseCookies(cookieHeader?: string | string[]): Record<string, string> {
  const header = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader
  if (!header) return {}
  const result: Record<string, string> = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key) result[key] = value
  }
  return result
}
