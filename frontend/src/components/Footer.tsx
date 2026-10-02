'use client';

import React from 'react';
import { vtInk, vtInkDim, vtGold, vtLine, vtMono, vtSerif } from './vtTokens';

export const FOOTER_COLUMNS: { title: string; links: [string, string][] }[] = [
  { title: 'company', links: [['About', '/about'], ['Support', '/tickets']] },
  { title: 'legal', links: [['Privacy Policy', '/privacy'], ['Terms of Service', '/terms'], ['Cookie Policy', '/cookies']] },
  { title: 'resources', links: [['FAQ', '/faq'], ['How it Works', '/how-it-works'], ['Security', '/security']] },
  { title: 'product', links: [['Marketplace', '/marketplace'], ['Wallets', '/wallets']] },
];

export function Footer({ wide }: { wide?: boolean }) {
  return (
    <div style={{ width: '100%', maxWidth: wide ? 640 : 420, marginTop: 56 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '22px 16px', marginBottom: 24 }}>
        {FOOTER_COLUMNS.map((col) => (
          <div key={col.title}>
            <div style={{ fontFamily: vtSerif, fontSize: 13, fontWeight: 700, color: vtGold, marginBottom: 10 }}>
              $ {col.title}
            </div>
            {col.links.map(([label, href]) => (
              <a key={href} href={href} style={{ display: 'block', fontFamily: vtMono, fontSize: 11.5, color: vtInkDim, textDecoration: 'none', marginBottom: 8 }}>
                {label}
              </a>
            ))}
          </div>
        ))}
      </div>
      <div style={{ borderTop: `1px solid ${vtLine}`, paddingTop: 14, textAlign: 'center' }}>
        <div style={{ fontFamily: vtMono, fontSize: 10.5, color: vtInkDim, opacity: 0.7, marginBottom: 8 }}>
          © 2026 iP2P. All rights reserved.
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, fontFamily: vtMono, fontSize: 10.5 }}>
          <a href="/privacy" style={{ color: vtGold, textDecoration: 'none' }}>Privacy Policy</a>
          <a href="/terms" style={{ color: vtGold, textDecoration: 'none' }}>Terms of Service</a>
        </div>
      </div>
    </div>
  );
}
