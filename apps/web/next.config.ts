import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
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
