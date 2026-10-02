'use client';

import React from 'react';
import { vtInk, vtInkDim, vtGold, vtSage, vtErr, vtLine, vtSurfaceDeep, vtMono } from './vtTokens';

export function VtEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: vtMono, fontSize: 11, letterSpacing: '0.1em', color: vtGold,
      textTransform: 'uppercase', marginBottom: 16, opacity: 0.85,
    }}>
      $ {children}
    </div>
  );
}

export function VtButton({
  children, onClick, disabled, type = 'button', variant = 'solid',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  variant?: 'solid' | 'outline';
}) {
  const solid = variant === 'solid';
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%', padding: '12px 16px', fontFamily: vtMono, fontSize: 13.5,
        fontWeight: 600, letterSpacing: '0.01em',
        color: solid ? '#17191A' : (disabled ? vtInkDim : vtGold),
        background: solid ? (disabled ? '#4A4A42' : vtGold) : 'transparent',
        border: solid ? 'none' : `1px solid ${disabled ? vtLine : vtGold}`,
        borderRadius: 5, cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export function VtTextLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        fontFamily: vtMono, fontSize: 12.5, color: vtGold, textDecoration: 'underline',
      }}
    >
      {children}
    </button>
  );
}

export function VtTextField({
  label, ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <div style={{ fontFamily: vtMono, fontSize: 11, color: vtInkDim, marginBottom: 6 }}>
        {label}
      </div>
      <input
        {...props}
        style={{
          width: '100%', padding: '10px 12px', fontFamily: vtMono, fontSize: 13.5,
          color: vtInk, background: vtSurfaceDeep, border: `1px solid ${vtLine}`, borderRadius: 5,
          boxSizing: 'border-box', outline: 'none',
        }}
      />
    </label>
  );
}

export function VtErrorText({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: vtMono, fontSize: 12, color: vtErr, margin: '-4px 0 14px', lineHeight: 1.5 }}>
      ! {children}
    </div>
  );
}

export function VtSuccessText({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: vtMono, fontSize: 12, color: vtSage, margin: '-4px 0 14px', lineHeight: 1.5 }}>
      ✓ {children}
    </div>
  );
}

export function VtSmallButton({
  children, onClick, disabled, muted,
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean; muted?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 12px', fontFamily: vtMono, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
        color: muted ? vtGold : (disabled ? '#6B6B63' : '#17191A'),
        background: muted ? 'transparent' : (disabled ? '#4A4A42' : vtGold),
        border: muted ? `1px solid ${disabled ? vtLine : vtGold}` : 'none',
        borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export function VtSmallLink({
  children, onClick, disabled,
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'none', border: 'none', padding: 0, marginTop: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: vtMono, fontSize: 11, color: vtGold, textDecoration: 'underline', opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function VtStamp({ children, color = vtSage }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{
      width: 64, height: 64, borderRadius: '50%', border: `1.5px solid ${color}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      margin: '4px auto 16px', transform: 'rotate(-6deg)', position: 'relative',
    }}>
      <div style={{ position: 'absolute', inset: 5, border: `1px solid ${color}`, borderRadius: '50%', opacity: 0.5 }} />
      <span style={{
        fontFamily: vtMono, fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
        color, textTransform: 'uppercase', textAlign: 'center', lineHeight: 1.3,
      }}>
        {children}
      </span>
    </div>
  );
}

export function VtMnemonicInput({
  words, onChange,
}: { words: string[]; onChange: (words: string[]) => void }) {
  const set = (i: number, value: string) => {
    const next = [...words];
    next[i] = value.trim().toLowerCase();
    onChange(next);
  };

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1,
      background: vtLine, border: `1px solid ${vtLine}`, borderRadius: 5, overflow: 'hidden', marginBottom: 20,
    }}>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} style={{ background: vtSurfaceDeep, padding: '8px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: vtMono, fontSize: 10, color: vtGold, opacity: 0.7, minWidth: 14 }}>
            {String(i + 1).padStart(2, '0')}
          </span>
          <input
            value={words[i] ?? ''}
            onChange={(e) => set(i, e.target.value)}
            style={{
              flex: 1, border: 'none', background: 'transparent', fontFamily: vtMono, fontSize: 13,
              color: vtInk, outline: 'none', minWidth: 0,
            }}
          />
        </div>
      ))}
    </div>
  );
}
