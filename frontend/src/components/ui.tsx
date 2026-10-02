'use client';

import React from 'react';
import { ink, paper, brass, brassDeep, line, err, mono, sans } from './tokens';

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: mono, fontSize: 11, letterSpacing: '0.14em', color: brassDeep,
        textTransform: 'uppercase', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8,
      }}
    >
      <span style={{ width: 16, height: 1, background: brassDeep, display: 'inline-block' }} />
      {children}
    </div>
  );
}

export function Stamp({ children, color = err }: { children: React.ReactNode; color?: string }) {
  return (
    <div
      style={{
        display: 'inline-block', border: `2px solid ${color}`, color, fontFamily: mono,
        fontSize: 11.5, letterSpacing: '0.08em', padding: '6px 10px', transform: 'rotate(-2deg)',
        borderRadius: 3, textTransform: 'uppercase', fontWeight: 700, opacity: 0.9,
      }}
    >
      {children}
    </div>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: paper, border: `1px solid ${line}`, borderRadius: 4,
        padding: '38px 34px', width: '100%', maxWidth: 440,
        boxShadow: '0 1px 0 rgba(0,0,0,0.04), 0 12px 28px -18px rgba(31,36,31,0.35)',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute', top: -9, left: 28, width: 18, height: 18, borderRadius: '50%',
          background: '#F3F3EE', border: `1px solid ${line}`,
        }}
      />
      {children}
    </div>
  );
}

export function PrimaryButton({
  children, onClick, disabled, type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%', padding: '13px 16px', fontFamily: sans, fontSize: 14.5,
        fontWeight: 600, letterSpacing: '0.01em', color: paper,
        background: disabled ? '#A9A9A0' : ink, border: 'none', borderRadius: 3,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export function TextLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        fontFamily: sans, fontSize: 13, color: brassDeep, textDecoration: 'underline',
      }}
    >
      {children}
    </button>
  );
}

export function TextField({
  label, ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: 'block', marginBottom: 16 }}>
      <div style={{ fontFamily: sans, fontSize: 12.5, color: ink, opacity: 0.65, marginBottom: 6 }}>
        {label}
      </div>
      <input
        {...props}
        style={{
          width: '100%', padding: '10px 12px', fontFamily: mono, fontSize: 14,
          color: ink, background: '#F5F5F0', border: `1px solid ${line}`, borderRadius: 3,
          boxSizing: 'border-box', outline: 'none',
        }}
      />
    </label>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: sans, fontSize: 12.5, color: err, margin: '-6px 0 16px', lineHeight: 1.5 }}>
      {children}
    </div>
  );
}
