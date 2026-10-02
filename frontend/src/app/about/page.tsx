'use client';

import React from 'react';
import { ContentPage } from '@/components/ContentPage';

export default function AboutPage() {
  return (
    <ContentPage
      eyebrow="about"
      title="about ip2p"
      intro="ip2p is a peer-to-peer marketplace for trading cryptocurrency for cash, built around one idea: neither iP2P nor either trading party should ever have to fully trust the other."
      sections={[
        {
          heading: 'noncustodial by design',
          body: [
            "your wallets are generated and encrypted in your own browser. iP2P never sees your recovery phrase or private keys — only you can decrypt them, with your password.",
          ],
        },
        {
          heading: 'escrow that no single party controls',
          body: [
            'every trade uses a 2-of-3 multisig address. the vendor, the customer, and iP2P each hold one key. moving funds always needs two of the three — iP2P alone can never do it, and neither can either trading party alone.',
          ],
        },
        {
          heading: 'verify, don\u2019t trust',
          body: [
            'before you ever sign a release or refund, your browser independently rebuilds the transaction and checks it against what you were shown. if anything is off, it refuses to let you sign.',
          ],
        },
      ]}
    />
  );
}
