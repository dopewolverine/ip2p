import Link from 'next/link';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton } from '@/components/vtUi';
import { vtGold, vtInkDim, vtMono } from '@/components/vtTokens';

export default function Home() {
  return (
    <AppShell section="Accounts & Keys">
      <VtPanel>
        <VtEyebrow>welcome</VtEyebrow>
        <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 700, color: '#E8E6DE', margin: '0 0 20px', textTransform: 'lowercase' }}>
          welcome to ip2p
        </h1>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
          <Link href="/register" style={{ textDecoration: 'none' }}>
            <VtButton>create an account</VtButton>
          </Link>
          <Link href="/login" style={{ textDecoration: 'none' }}>
            <VtButton variant="outline">log in</VtButton>
          </Link>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Link href="/forgot-password" style={{ fontFamily: vtMono, fontSize: 12.5, color: vtGold, textDecoration: 'underline' }}>
            forgot your password?
          </Link>
          <Link href="/recover" style={{ fontFamily: vtMono, fontSize: 12.5, color: vtGold, textDecoration: 'underline' }}>
            recover with your seed phrase
          </Link>
        </div>
      </VtPanel>
    </AppShell>
  );
}
