'use client';

import React from 'react';
import { ink, line, mono } from './tokens';

// 12-cell entry grid - visual counterpart to the read-only reveal grid,
// used anywhere the user has to type their phrase back in (password reset
// with seed, seed-phrase recovery).
export function MnemonicInput({
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
      background: line, border: `1px solid ${line}`, borderRadius: 3, overflow: 'hidden', marginBottom: 22,
    }}>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} style={{ background: '#F5F5F0', padding: '8px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: mono, fontSize: 10.5, color: ink, opacity: 0.45, minWidth: 14 }}>
            {String(i + 1).padStart(2, '0')}
          </span>
          <input
            value={words[i] ?? ''}
            onChange={(e) => set(i, e.target.value)}
            style={{
              flex: 1, border: 'none', background: 'transparent', fontFamily: mono, fontSize: 13,
              color: ink, outline: 'none', minWidth: 0,
            }}
          />
        </div>
      ))}
    </div>
  );
}
