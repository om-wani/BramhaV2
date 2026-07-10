/**
 * Web MCP server — tool implementations.
 *
 * Security invariants:
 * - Only allowlisted hostnames accepted (exact match, no wildcards)
 * - RFC-1918 / loopback / link-local blocked even if in allowlist
 * - Response body capped at 1 MB
 * - Raw fetch errors never returned to caller
 */

// ── Private network detection ─────────────────────────────────────────────────

/**
 * Returns true if the hostname is a loopback, RFC-1918, or link-local address
 * that should never be reachable from the MCP web server.
 *
 * Blocked ranges:
 *   Loopback:    127.0.0.0/8, ::1
 *   Link-local:  169.254.0.0/16, fe80::/10
 *   RFC-1918:    10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *   Metadata:    169.254.169.254 (AWS/GCP/Azure IMDS)
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().trim()

  // Exact loopback names
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true

  // IPv4 address check
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(h)
  if (ipv4Match) {
    const [, a, b] = ipv4Match
    const octet1 = parseInt(a ?? '0', 10)
    const octet2 = parseInt(b ?? '0', 10)

    // 127.0.0.0/8 — loopback
    if (octet1 === 127) return true

    // 10.0.0.0/8 — RFC-1918
    if (octet1 === 10) return true

    // 172.16.0.0/12 — RFC-1918 (172.16–172.31)
    if (octet1 === 172 && octet2 >= 16 && octet2 <= 31) return true

    // 192.168.0.0/16 — RFC-1918
    if (octet1 === 192 && octet2 === 168) return true

    // 169.254.0.0/16 — link-local / APIPA / cloud metadata
    if (octet1 === 169 && octet2 === 254) return true

    // 0.0.0.0
    if (octet1 === 0) return true

    return false
  }

  // IPv6 checks
  if (h === '::1') return true
  // fe80::/10 — link-local IPv6
  if (h.startsWith('fe80:') || h.startsWith('fe80::')) return true
  // fc00::/7 — unique local IPv6
  if (h.startsWith('fc') || h.startsWith('fd')) return true

  // Bracketed IPv6 (e.g. [::1])
  if (h.startsWith('[') && h.endsWith(']')) {
    return isPrivateHost(h.slice(1, -1))
  }

  return false
}

// ── Allowlist check ───────────────────────────────────────────────────────────

/**
 * Check if a hostname is in the allowlist (exact match, case-insensitive, no wildcards).
 */
export function isAllowedHost(hostname: string, allowlist: string[]): boolean {
  const h = hostname.toLowerCase().trim()
  return allowlist.some((a) => a.toLowerCase().trim() === h)
}

// ── Response cap ──────────────────────────────────────────────────────────────

export const MAX_RESPONSE_BYTES = 1 * 1024 * 1024 // 1 MB

// ── Fetch abstraction (injectable for testing) ─────────────────────────────────

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

// ── Tool: fetch ───────────────────────────────────────────────────────────────

export interface FetchResult {
  content?: string
  statusCode?: number
  error?: string
}

export async function webFetch(
  url: string,
  method: 'GET' | 'POST' = 'GET',
  body: string | undefined,
  allowlist: string[],
  fetchFn: FetchFn = globalThis.fetch,
): Promise<FetchResult> {
  // 1. Parse URL to extract hostname
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { error: 'invalid_url' }
  }

  const hostname = parsed.hostname

  // 2. Block private/loopback hosts (even if on allowlist — defense in depth)
  if (isPrivateHost(hostname)) {
    return { error: 'host_not_allowed' }
  }

  // 3. Check allowlist
  if (!isAllowedHost(hostname, allowlist)) {
    return { error: 'host_not_allowed' }
  }

  // 4. Execute fetch
  try {
    const init: RequestInit = {
      method,
      headers: {
        'User-Agent': 'BramhaMCP/1.0',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
    }
    // Only set body if defined — exactOptionalPropertyTypes requires this
    if (body !== undefined) {
      init.body = body
    }
    const response = await fetchFn(url, init)

    // 5. Cap response size
    const contentLength = response.headers.get('content-length')
    if (contentLength !== null) {
      const len = parseInt(contentLength, 10)
      if (!isNaN(len) && len > MAX_RESPONSE_BYTES) {
        return { error: 'response_too_large' }
      }
    }

    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > MAX_RESPONSE_BYTES) {
      return { error: 'response_too_large' }
    }

    const content = new TextDecoder('utf-8').decode(buffer)
    return { content, statusCode: response.status }
  } catch {
    // Never return raw fetch error (may contain internal network info)
    return { error: 'fetch_failed' }
  }
}

// ── Tool: search ──────────────────────────────────────────────────────────────

export interface SearchResult {
  content?: string
  error?: string
}

export interface SearchConfig {
  braveApiKey?: string | undefined
  tavilyApiKey?: string | undefined
}

export async function webSearch(
  query: string,
  engine: 'brave' | 'tavily' = 'brave',
  config: SearchConfig,
  allowlist: string[],
  fetchFn: FetchFn = globalThis.fetch,
): Promise<SearchResult> {
  if (!query.trim()) return { error: 'empty_query' }

  if (engine === 'brave') {
    if (!config.braveApiKey) return { error: 'search_not_configured' }

    const result = await webFetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`,
      'GET',
      undefined,
      allowlist,
      async (url, init) => {
        return fetchFn(url, {
          ...init,
          headers: {
            ...(init?.headers as Record<string, string> | undefined),
            'Accept': 'application/json',
            'X-Subscription-Token': config.braveApiKey ?? '',
          },
        })
      },
    )
    if (result.error) return { error: result.error }
    if (result.content === undefined) return { error: 'empty_response' }
    return { content: result.content }
  }

  if (engine === 'tavily') {
    if (!config.tavilyApiKey) return { error: 'search_not_configured' }

    const result = await webFetch(
      'https://api.tavily.com/search',
      'POST',
      JSON.stringify({ api_key: config.tavilyApiKey, query }),
      allowlist,
      fetchFn,
    )
    if (result.error) return { error: result.error }
    if (result.content === undefined) return { error: 'empty_response' }
    return { content: result.content }
  }

  return { error: 'unknown_engine' }
}
