/**
 * /artifact-frame — sandboxed artifact renderer
 *
 * Fetches artifact content from a presigned S3 URL (passed as ?url=) and
 * returns a complete HTML document tailored to the artifact kind. The response
 * carries a strict Content-Security-Policy so the rendered document cannot
 * make outbound network requests or escape the iframe sandbox.
 *
 * The route is intentionally excluded from the main-app middleware CSP so that
 * the `frame-ancestors 'self'` policy set here is the only one in effect (see
 * middleware.ts).
 *
 * Security model:
 *  - connect-src 'none' blocks all fetch/XHR from inside the frame
 *  - script-src allows 'unsafe-inline' and (for react kind) https://unpkg.com
 *  - The parent ArtifactFrame component uses sandbox="allow-scripts" which
 *    removes same-origin access, so document.cookie / top.location are
 *    inaccessible regardless of CSP
 *  - Origin validation in ArtifactFrame.tsx ignores messages from wrong origins
 */

import { NextRequest, NextResponse } from 'next/server'

type ArtifactKind =
  | 'code'
  | 'react'
  | 'html'
  | 'document'
  | 'markdown'
  | 'svg'
  | 'mermaid'
  | 'csv'

// ── CSP helpers ────────────────────────────────────────────────────────────────

const BASE_DIRECTIVES = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "connect-src 'none'",
  "img-src data: blob:",
]

function buildCsp(kind: ArtifactKind): string {
  // react kind loads React + ReactDOM + Babel from unpkg CDN
  const scriptSrc =
    kind === 'react'
      ? "script-src 'unsafe-inline' https://unpkg.com"
      : "script-src 'unsafe-inline'"
  return [...BASE_DIRECTIVES, scriptSrc, "frame-ancestors 'self'"].join('; ')
}

const RESPONSE_HEADERS = (kind: ArtifactKind) =>
  ({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': buildCsp(kind),
    // SAMEORIGIN so the parent Next.js app can embed this in an iframe
    'X-Frame-Options': 'SAMEORIGIN',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }) as Record<string, string>

// ── Escape helpers ─────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Prevent </script> in user content from prematurely closing the script tag */
function escapeForScriptTag(s: string): string {
  return s.replace(/<\/script/gi, '<\\/script')
}

// ── postMessage bridge (inlined in every frame) ────────────────────────────────

const BRIDGE = /* js */ `
;(function initBridge() {
  function sendResize() {
    parent.postMessage(
      { type: 'resize', height: Math.max(document.documentElement.scrollHeight, 40) },
      '*'
    )
  }
  window.addEventListener('error', function (e) {
    parent.postMessage({ type: 'error', message: e.message || String(e) }, '*')
  })
  window.addEventListener('unhandledrejection', function (e) {
    parent.postMessage({ type: 'error', message: String(e.reason) }, '*')
  })
  ;['log', 'warn', 'error'].forEach(function (level) {
    var orig = console[level]
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments).map(String)
      parent.postMessage({ type: 'console', level: level, args: args }, '*')
      orig.apply(console, arguments)
    }
  })
  window.addEventListener('load', function () {
    sendResize()
    parent.postMessage({ type: 'ready' }, '*')
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(sendResize).observe(document.body)
    }
  })
})()
`

// ── HTML builders per kind ─────────────────────────────────────────────────────

function wrap(head: string, body: string, extraScript = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${head}
</head>
<body>
${body}
<script>${BRIDGE}${extraScript}</script>
</body>
</html>`
}

function buildHtml(content: string): string {
  return wrap(
    `<style>body{margin:0;padding:8px;font-family:system-ui,sans-serif}*{box-sizing:border-box}</style>`,
    content,
  )
}

function buildReact(content: string): string {
  const escaped = escapeForScriptTag(content)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:8px;font-family:system-ui,sans-serif}*{box-sizing:border-box}</style>
<script src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body>
<div id="root"></div>
<script type="text/babel" data-presets="react">
${BRIDGE}
;(function () {
${escaped}
var rootEl = document.getElementById('root')
if (typeof App !== 'undefined' && rootEl) {
  ReactDOM.createRoot(rootEl).render(React.createElement(App))
} else if (rootEl && rootEl.innerHTML === '') {
  rootEl.innerHTML =
    '<p style="color:#888;font-size:13px">Define a function named <code>App</code> to render.</p>'
  parent.postMessage({ type: 'ready' }, '*')
}
})()
</script>
</body>
</html>`
}

function buildCode(content: string, lang = ''): string {
  return wrap(
    `<style>
      body{margin:0;background:#0f172a;color:#e2e8f0}
      pre{margin:0;padding:16px;overflow-x:auto;font-family:'Menlo','Monaco','Consolas',monospace;font-size:13px;line-height:1.6;white-space:pre}
    </style>`,
    `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(content)}</code></pre>`,
    `document.addEventListener('DOMContentLoaded',function(){
      parent.postMessage({type:'resize',height:document.body.scrollHeight},'*')
      parent.postMessage({type:'ready'},'*')
    })`,
  )
}

function buildMarkdown(content: string): string {
  return wrap(
    `<style>
      body{margin:0;padding:16px;background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif;font-size:14px;line-height:1.7}
      pre{background:#1e293b;border-radius:4px;padding:12px;overflow-x:auto}
      code{font-family:monospace;font-size:13px}
      blockquote{border-left:3px solid #475569;margin:0;padding-left:12px;color:#94a3b8}
      h1,h2,h3,h4{color:#f1f5f9}
    </style>`,
    `<pre style="white-space:pre-wrap;background:transparent;padding:0;font-family:inherit;font-size:inherit">${escapeHtml(content)}</pre>`,
  )
}

function buildCsv(content: string): string {
  const lines = content.trim().split(/\r?\n/)
  const rows = lines.map((l) =>
    l.split(',').map((c) => c.trim().replace(/^"(.*)"$/, '$1')),
  )
  const header = rows[0] ?? []
  const body = rows.slice(1)
  const headerHtml = header.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const bodyHtml = body
    .map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('\n')
  return wrap(
    `<style>
      body{margin:0;padding:16px;background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif}
      table{border-collapse:collapse;width:100%;font-size:13px}
      th{background:#1e293b;padding:6px 10px;text-align:left;font-weight:600;border-bottom:2px solid #334155}
      td{padding:5px 10px;border-bottom:1px solid #1e293b}
      tr:hover td{background:#1e293b}
    </style>`,
    `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`,
  )
}

function buildMermaid(content: string): string {
  return wrap(
    `<style>
      body{margin:0;padding:16px;background:#0f172a;color:#e2e8f0;font-family:monospace;font-size:13px}
      .note{color:#94a3b8;font-family:system-ui,sans-serif;font-size:12px;margin-bottom:8px}
      pre{white-space:pre-wrap;margin:0}
    </style>`,
    `<p class="note">Mermaid diagram source:</p><pre>${escapeHtml(content)}</pre>`,
  )
}

function buildSvg(content: string): string {
  return wrap(
    `<style>
      body{margin:0;padding:16px;background:#0f172a;display:flex;justify-content:center;align-items:flex-start}
      svg{max-width:100%;height:auto}
    </style>`,
    content,
  )
}

function buildError(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  body{margin:0;padding:16px;background:#0f172a;color:#f87171;font-family:system-ui,sans-serif;font-size:14px}
  .err{background:#450a0a;border:1px solid #7f1d1d;border-radius:6px;padding:12px 16px}
</style>
</head>
<body>
<div class="err" role="alert">
  <strong>Error loading artifact: </strong>
  <code>${escapeHtml(message)}</code>
</div>
<script>
parent.postMessage({type:'error',message:${JSON.stringify(message)}},'*')
parent.postMessage({type:'resize',height:document.body.scrollHeight},'*')
</script>
</body>
</html>`
}

// ── Route handler ──────────────────────────────────────────────────────────────

const VALID_KINDS = new Set<string>([
  'code', 'react', 'html', 'document', 'markdown', 'svg', 'mermaid', 'csv',
])

export async function GET(request: NextRequest): Promise<NextResponse> {
  const sp = request.nextUrl.searchParams
  const rawUrl = sp.get('url')
  const rawKind = sp.get('kind') ?? 'code'
  const kind: ArtifactKind = VALID_KINDS.has(rawKind) ? (rawKind as ArtifactKind) : 'code'

  if (!rawUrl) {
    return new NextResponse('Missing required parameter: url', { status: 400 })
  }

  // Basic URL validation
  let parsedUrl: URL
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    return new NextResponse('Invalid url parameter', { status: 400 })
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    return new NextResponse('URL must use http: or https:', { status: 400 })
  }

  // SSRF guard — block obvious internal hosts in production
  if (process.env.NODE_ENV === 'production') {
    const h = parsedUrl.hostname.toLowerCase()
    if (
      h === 'localhost' ||
      h.startsWith('127.') ||
      h.startsWith('169.254.') ||
      h === '::1' ||
      h === '[::1]'
    ) {
      return new NextResponse('URL host not allowed', { status: 400 })
    }
  }

  // Fetch artifact content from presigned URL (server-side — no auth headers forwarded)
  let content: string
  try {
    const resp = await fetch(rawUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: '*/*' },
    })
    if (!resp.ok) {
      throw new Error(`Upstream ${resp.status} ${resp.statusText}`)
    }
    content = await resp.text()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load artifact content'
    return new NextResponse(buildError(msg), {
      status: 200,
      headers: RESPONSE_HEADERS(kind),
    })
  }

  let html: string
  switch (kind) {
    case 'html':
      html = buildHtml(content)
      break
    case 'react':
      html = buildReact(content)
      break
    case 'markdown':
    case 'document':
      html = buildMarkdown(content)
      break
    case 'csv':
      html = buildCsv(content)
      break
    case 'mermaid':
      html = buildMermaid(content)
      break
    case 'svg':
      html = buildSvg(content)
      break
    case 'code':
    default:
      html = buildCode(content)
      break
  }

  return new NextResponse(html, {
    status: 200,
    headers: RESPONSE_HEADERS(kind),
  })
}
