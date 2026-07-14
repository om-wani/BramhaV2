/** @type {import('next').NextConfig} */

// In split-origin production (web on Vercel, api on Render) the browser refuses
// to send Render's auth cookies back on fetch/XHR — they're third-party to the
// Vercel page, and Chrome/Safari drop third-party cookies regardless of
// SameSite=None. Proxying the API under the web origin (/backend/* -> Render)
// makes those cookies first-party, so the SameSite=Lax/Strict scheme works
// again. Set BACKEND_ORIGIN (server-only, NOT NEXT_PUBLIC_) on Vercel to the
// Render URL, e.g. https://bramhav2.onrender.com. Left unset in local dev, where
// web and api are already same-site (both localhost) and need no proxy.
const backendOrigin = process.env.BACKEND_ORIGIN

const nextConfig = {
  reactStrictMode: true,
  // Required for Docker image: bundles server + minimal node_modules
  output: 'standalone',
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3001'],
    },
  },
  // CSP nonce is injected via middleware.ts
  // Headers set via middleware for full nonce support

  async rewrites() {
    if (!backendOrigin) return []
    return [
      {
        source: '/backend/:path*',
        destination: `${backendOrigin}/:path*`,
      },
    ]
  },

  async headers() {
    if (!backendOrigin) return []
    // Never let the CDN cache proxied auth/API responses.
    return [
      {
        source: '/backend/:path*',
        headers: [{ key: 'x-vercel-enable-rewrite-caching', value: '0' }],
      },
    ]
  },
}

export default nextConfig
