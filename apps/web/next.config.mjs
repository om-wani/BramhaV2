/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3001'],
    },
  },
  // CSP nonce is injected via middleware.ts
  // Headers set via middleware for full nonce support
}

export default nextConfig
