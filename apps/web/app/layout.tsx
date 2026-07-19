import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { QueryProvider } from '@/providers/query-client';

export const metadata: Metadata = {
  title: 'Bramha — Your AI C-Suite',
  description: 'Eight executive agents that know when to speak.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the nonce injected by middleware. Next.js uses the x-nonce request header
  // to attach the nonce to its own inline scripts during SSR. The middleware also
  // includes 'self' in script-src so same-origin bundles load without a nonce match.
  const nonce = (await headers()).get('x-nonce') ?? '';
  return (
    <html lang="en" className="dark">
      <body>
        <QueryProvider>{children}</QueryProvider>
        {/* Expose nonce to hydration scripts via data attribute on body */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: '' }}
          suppressHydrationWarning
        />
      </body>
    </html>
  );
}
