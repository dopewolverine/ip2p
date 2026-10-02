'use client';

import React, { useEffect, useState } from 'react';
import { vtBg, vtSurface, vtInk, vtGold, vtSteel, vtLine, vtSurfaceDeep, vtMono, vtSerif, vtInkDim } from './vtTokens';
import { Footer } from './Footer';
import { me } from '@/lib/api/auth';

function LogoMark() {
  return (
    <div style={{
      width: 22, height: 22, borderRadius: 5, border: `1.5px solid ${vtGold}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <span style={{ fontFamily: vtSerif, fontSize: 12, fontWeight: 700, color: vtGold, lineHeight: 1 }}>i</span>
    </div>
  );
}

function IconBtn({
  href, onClick, gold, children,
}: { href?: string; onClick?: () => void; gold?: boolean; children: React.ReactNode }) {
  const box = (
    <div style={{
      width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: vtSurfaceDeep, border: `1px solid ${gold ? '#4A3E17' : '#34372F'}`, borderRadius: 6,
    }}>
      <svg viewBox="0 0 20 20" width={15} height={15} style={{
        stroke: gold ? vtGold : vtSteel, fill: 'none', strokeWidth: 1.6,
        filter: `drop-shadow(0 0 ${gold ? 4 : 3}px ${gold ? 'rgba(201,162,39,0.85)' : 'rgba(107,140,163,0.7)'})`,
      }}>
        {children}
      </svg>
    </div>
  );
  if (href) return <a href={href} style={{ textDecoration: 'none' }}>{box}</a>;
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
      {box}
    </button>
  );
}

function MenuTrigger({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: vtSurfaceDeep, border: `1px solid ${active ? vtGold : '#4A3E17'}`, borderRadius: 6,
        cursor: 'pointer', fontFamily: vtSerif, fontSize: 13, color: vtGold,
        filter: 'drop-shadow(0 0 4px rgba(201,162,39,0.6))',
      }}
    >
      $_
    </button>
  );
}

const QUICK_LINKS: [string, string][] = [
  ['marketplace', '/marketplace'],
  ['wallets', '/wallets'],
  ['faq', '/faq'],
  ['support', '/tickets'],
];

function IconNav({
  onLogout, isStaff, menuOpen, onToggleMenu,
}: { onLogout: () => void; isStaff: boolean; menuOpen: boolean; onToggleMenu: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <IconBtn href="/notifications">
        <path d="M10 3a4 4 0 0 0-4 4v3.2c0 .6-.25 1.2-.7 1.6L4 13h12l-1.3-1.2a2.2 2.2 0 0 1-.7-1.6V7a4 4 0 0 0-4-4z" />
        <path d="M8.2 15a1.8 1.8 0 0 0 3.6 0" />
      </IconBtn>
      <IconBtn href="/tickets">
        <path d="M4 10.5a6 6 0 0 1 12 0" />
        <rect x="3" y="10" width="3" height="5" rx="1" />
        <rect x="14" y="10" width="3" height="5" rx="1" />
      </IconBtn>
      <IconBtn href="/account/telegram">
        <path d="M3 10.5 17 3.5 12.5 17l-3-6-6.5-2z" />
      </IconBtn>
      {isStaff && (
        <IconBtn href="/admin/disputes" gold>
          <path d="M10 3v14M4 6.5h12M4 6.5 2 11h4L4 6.5zM16 6.5l-2 4.5h4l-2-4.5z" />
        </IconBtn>
      )}
      <MenuTrigger active={menuOpen} onClick={onToggleMenu} />
      <IconBtn onClick={onLogout} gold>
        <path d="M8 3H4.5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1H8" />
        <path d="M12.5 6.5 16.5 10l-4 3.5" />
        <path d="M16 10H7" />
      </IconBtn>
    </div>
  );
}

export function AppShell({
  children, wide, section, accountNav, onLogout,
}: {
  children: React.ReactNode;
  wide?: boolean;
  section: string;
  accountNav?: boolean;
  onLogout?: () => void;
}) {
  const [isStaff, setIsStaff] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!accountNav) return;
    me().then((res) => setIsStaff(res.role === 'staff' || res.role === 'owner')).catch(() => {});
  }, [accountNav]);

  return (
    <div style={{
      minHeight: '100vh', background: vtBg, display: 'flex', flexDirection: 'column',
      alignItems: 'center', padding: '36px 16px 60px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', maxWidth: wide ? 640 : 420, marginBottom: 12, gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LogoMark />
          <span style={{
            fontFamily: vtMono, fontSize: 11, letterSpacing: '0.18em', color: vtInk,
            opacity: 0.55, textTransform: 'uppercase',
          }}>
            iP2P — {section}
          </span>
        </div>
        {accountNav && onLogout && (
          <IconNav onLogout={onLogout} isStaff={isStaff} menuOpen={menuOpen} onToggleMenu={() => setMenuOpen((v) => !v)} />
        )}
      </div>

      {menuOpen && (
        <div style={{ width: '100%', maxWidth: wide ? 640 : 420, display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {QUICK_LINKS.map(([label, href]) => (
            <a
              key={href}
              href={href}
              style={{
                fontFamily: vtMono, fontSize: 10.5, padding: '6px 12px', borderRadius: 999,
                border: `1px solid ${vtLine}`, color: vtInkDim, textDecoration: 'none',
              }}
            >
              {label}
            </a>
          ))}
        </div>
      )}

      <div style={{ width: '100%', maxWidth: wide ? 640 : 420 }}>{children}</div>
      <Footer wide={wide} />
    </div>
  );
}

export function VtPanel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: vtSurface, border: `1px solid ${vtLine}`, borderRadius: 8,
      padding: '26px 22px', width: '100%',
      boxShadow: '0 24px 48px -30px rgba(0,0,0,0.7)',
    }}>
      {children}
    </div>
  );
}
