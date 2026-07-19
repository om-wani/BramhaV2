import type { Metadata } from 'next';
import './globals.css';
import { QueryProvider } from '@/providers/query-client';

export const metadata: Metadata = {
  title: 'Bramha — Your AI C-Suite',
  description: 'Eight executive agents that know when to speak.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
