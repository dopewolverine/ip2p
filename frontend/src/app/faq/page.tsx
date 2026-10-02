'use client';

import React from 'react';
import { ContentPage } from '@/components/ContentPage';

export default function FaqPage() {
  return (
    <ContentPage
      eyebrow="faq"
      title="frequently asked questions"
      sections={[
        {
          heading: 'is ip2p custodial? does ip2p hold my crypto?',
          body: ["no. your wallets are generated and encrypted entirely in your browser. iP2P never has access to your private keys or recovery phrase — we couldn't move your funds even if we wanted to."],
        },
        {
          heading: 'what is the recovery phrase, and what happens if i lose it?',
          body: ["it's a 12-word phrase generated on your device when you register. it's the only way to recover your wallets if you forget your password or switch devices. iP2P cannot reset or recover it for you — if it's lost with no backup, funds encrypted under it are permanently inaccessible."],
        },
        {
          heading: 'how does escrow work?',
          body: ['when a trade is accepted, both the vendor and the customer each contribute a key to a 2-of-3 multisig address (the third key belongs to iP2P, held only for dispute cases). the funder sends crypto into that address. once the buyer confirms fiat payment was sent, the seller releases the funds.'],
        },
        {
          heading: 'what happens if something goes wrong?',
          body: ['either party can open a dispute. iP2P staff review the chat, uploaded evidence, and transaction history, then recommend an outcome. final decisions in disputes are made by iP2P\u2019s owner using a hardware wallet, with the destination address independently verified before anything is signed.'],
        },
        {
          heading: 'what cryptocurrencies are supported?',
          body: ['bitcoin, litecoin, ethereum, usdt (erc20 and trc20), and usdc (erc20).'],
        },
        {
          heading: 'are there fees?',
          body: ['escrow trades carry a small percentage fee, shown before you accept a trade or confirm a release \u2014 never a surprise deduction afterward.'],
        },
        {
          heading: 'can i trust the release transaction before i sign it?',
          body: ['yes \u2014 before you ever sign a release or refund, your browser independently rebuilds and verifies the transaction and compares it against what\u2019s shown to you. if anything doesn\u2019t match, it refuses to let you sign.'],
        },
      ]}
    />
  );
}
