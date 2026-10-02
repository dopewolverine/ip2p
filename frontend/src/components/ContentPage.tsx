'use client';

import React from 'react';
import { AppShell, VtPanel } from './AppShell';
import { VtEyebrow } from './vtUi';
import { vtInk, vtInkDim, vtGold, vtMono } from './vtTokens';

export interface ContentSection {
  heading: string;
  body: string[];
}

export function ContentPage({
  eyebrow, title, intro, sections, disclaimer,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  sections: ContentSection[];
  disclaimer?: string;
}) {
  return (
    <AppShell section={eyebrow}>
      <VtPanel>
        <VtEyebrow>{eyebrow}</VtEyebrow>
        <h1 style={titleStyle}>{title}</h1>
        {disclaimer && (
          <div style={{
            fontFamily: vtMono, fontSize: 11, color: vtGold, lineHeight: 1.6,
            background: 'rgba(201,162,39,0.08)', border: '1px solid #4A3E17', borderRadius: 5,
            padding: '10px 12px', marginBottom: 18,
          }}>
            {disclaimer}
          </div>
        )}
        {intro && <p style={pStyle}>{intro}</p>}
        {sections.map((s) => (
          <div key={s.heading} style={{ marginBottom: 18 }}>
            <div style={headingStyle}>{s.heading}</div>
            {s.body.map((p, i) => <p key={i} style={pStyle}>{p}</p>)}
          </div>
        ))}
      </VtPanel>
    </AppShell>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Fraunces', Georgia, serif", fontSize: 21, fontWeight: 700, color: vtInk, margin: '0 0 16px', textTransform: 'lowercase',
};
const headingStyle: React.CSSProperties = {
  fontFamily: vtMono, fontSize: 12, color: vtGold, marginBottom: 6, fontWeight: 600,
};
const pStyle: React.CSSProperties = {
  fontFamily: vtMono, fontSize: 12, color: vtInkDim, lineHeight: 1.65, margin: '0 0 8px',
};
