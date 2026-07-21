/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Socket.IO handshakes at /backend/socket.io/ — the trailing slash matters.
  // Without this, Next.js 308-redirects to strip it, so the proxied request
  // reaches the server as /socket.io (no slash) and engine.io 404s.
  skipTrailingSlashRedirect: true,
  transpilePackages: ['@bramha/shared'],
  webpack(webpackConfig) {
    // Workspace packages use NodeNext `.js` import specifiers that point at
    // `.ts` source. Teach webpack to resolve `.js` → `.ts`/`.tsx` first.
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return webpackConfig;
  },
  async rewrites() {
    const serverOrigin = process.env['BACKEND_ORIGIN'] ?? 'http://localhost:3001';
    return [
      {
        source: '/backend/:path*',
        destination: `${serverOrigin}/:path*`,
      },
    ];
  },
};

export default config;
