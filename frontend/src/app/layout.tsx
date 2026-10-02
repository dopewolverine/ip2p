import type { Metadata } from 'next';
import './globals.css';
import { paperDeep, sans } from '@/components/tokens';
import { WalletSessionProvider } from '@/lib/walletSession';

export const metadata: Metadata = {
  title: 'iP2P',
  description: 'Accounts & keys',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body style={{ background: paperDeep, fontFamily: sans, minHeight: '100vh' }}>
        <WalletSessionProvider>{children}</WalletSessionProvider>
      </body>
    </html>
  );
}
