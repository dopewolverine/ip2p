'use client';

import React, { useMemo, useState } from 'react';
import { VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton, VtTextField, VtErrorText } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtLine, vtSurfaceDeep, vtMono } from '@/components/vtTokens';

// Shown at registration, and again at login for an account that never
// finished confirming its phrase (P0 §5.2 - it must be able to resume).

function pickThreePositions(): number[] {
  const idx = new Set<number>();
  while (idx.size < 3) idx.add(Math.floor(Math.random() * 12));
  return [...idx].sort((a, b) => a - b);
}

export function RevealScreen({ words, onContinue }: { words: string[]; onContinue: () => void }) {
  const [ack, setAck] = useState(false);
  return (
    <VtPanel>
      <VtEyebrow>backup — step 1 of 2</VtEyebrow>
      <h1 style={titleStyle}>your recovery phrase</h1>
      <p style={subStyle}>
        these 12 words are the only way to recover your wallets. write them down in order,
        on paper, somewhere private. anyone who has them has your funds.
      </p>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1,
        background: vtLine, border: `1px solid ${vtLine}`, borderRadius: 5, overflow: 'hidden', marginBottom: 20,
      }}>
        {words.map((w, i) => (
          <div key={i} style={{ background: vtSurfaceDeep, padding: '10px 8px', display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontFamily: vtMono, fontSize: 10, color: vtGold, opacity: 0.8, minWidth: 14 }}>
              {String(i + 1).padStart(2, '0')}
            </span>
            <span style={{ fontFamily: vtMono, fontSize: 13, color: vtInk }}>{w}</span>
          </div>
        ))}
      </div>

      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 20, cursor: 'pointer' }}>
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: 3 }} />
        <span style={{ fontFamily: vtMono, fontSize: 12, color: vtInkDim, lineHeight: 1.5 }}>
          i've written down all 12 words in order. i understand ip2p cannot recover them for me.
        </span>
      </label>

      <VtButton disabled={!ack} onClick={onContinue}>continue to verification</VtButton>
    </VtPanel>
  );
}

export function ConfirmScreen({
  words, onDone, onReshow,
}: { words: string[]; onDone: () => Promise<void>; onReshow: () => void }) {
  const positions = useMemo(() => pickThreePositions(), [words]);
  const [values, setValues] = useState<Record<number, string>>({});
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    const ok = positions.every((i) => (values[i] ?? '').trim().toLowerCase() === words[i]);
    if (ok) {
      setBusy(true);
      setError(null);
      try {
        await onDone();
      } catch {
        setError('could not confirm — check your connection and try again.');
        setBusy(false);
      }
      return;
    }
    const next = attempt + 1;
    setAttempt(next);
    setError("that doesn't match.");
    if (next >= 3) onReshow();
  };

  return (
    <VtPanel>
      <VtEyebrow>backup — step 2 of 2</VtEyebrow>
      <h1 style={titleStyle}>confirm your phrase</h1>
      <p style={subStyle}>enter the words at these three positions from what you just wrote down.</p>

      {positions.map((i) => (
        <VtTextField
          key={i}
          label={`word #${i + 1}`}
          value={values[i] ?? ''}
          onChange={(e) => setValues((v) => ({ ...v, [i]: e.target.value }))}
        />
      ))}

      {error && (
        <VtErrorText>
          {error} {attempt > 0 && attempt < 3 ? `${3 - attempt} attempt${3 - attempt === 1 ? '' : 's'} left before we show the phrase again.` : ''}
        </VtErrorText>
      )}

      <VtButton disabled={busy} onClick={check}>{busy ? 'working…' : 'confirm and activate'}</VtButton>
    </VtPanel>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Fraunces', Georgia, serif", fontSize: 21, fontWeight: 700,
  color: vtInk, margin: '0 0 12px', textTransform: 'lowercase',
};
const subStyle: React.CSSProperties = { fontFamily: vtMono, fontSize: 12, color: vtInkDim, margin: '0 0 18px', lineHeight: 1.6 };
