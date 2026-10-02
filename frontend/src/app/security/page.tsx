'use client';

import React from 'react';
import { ContentPage } from '@/components/ContentPage';

export default function SecurityPage() {
  return (
    <ContentPage
      eyebrow="security"
      title="how ip2p keeps you safe"
      sections={[
        { heading: 'your keys never leave your device', body: ['your 12-word recovery phrase is generated in your browser and encrypted there with a key derived from your password. only the encrypted result is sent to iP2P\u2019s servers, and we can\u2019t decrypt it without your password. we will never ask you for your phrase.'] },
        { heading: 'escrow is never single-custody', body: ['every escrow trade uses a 2-of-3 multisig address. iP2P\u2019s key alone can never move funds \u2014 it only becomes useful together with one of the trading parties\u2019 keys: in a dispute, or to return coins sent to a cancelled trade.'] },
        { heading: 'your browser checks before it signs', body: ['before you fund an escrow, your browser rebuilds its address from the three public keys \u2014 using the platform key built into this site, not one supplied by our servers \u2014 and checks both payout addresses. before it signs a release or refund, it checks every output (recipient, amount, platform fee, network fee) and refuses to sign if anything differs. wallet withdrawals get the same check.'] },
        { heading: 'two-factor authentication', body: ['you can require a time-based one-time code on login, with one-time recovery codes for backup. a password reset by email also needs your code. disabling 2fa takes effect 48 hours after the request and is reported to you, so an attacker can\u2019t quietly turn it off.'] },
        { heading: 'you\u2019re notified of anything sensitive', body: ['new device logins, password changes, 2fa changes and recovery-phrase account recovery trigger a security notification in your account, and by email if your account has one \u2014 regardless of your notification settings.'] },
        { heading: 'exporting a key is always explicit', body: ['revealing a wallet\u2019s private key requires an acknowledgment step and is never available by accident.'] },
      ]}
    />
  );
}
