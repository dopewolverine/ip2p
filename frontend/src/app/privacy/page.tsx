'use client';

import React from 'react';
import { ContentPage } from '@/components/ContentPage';

export default function PrivacyPage() {
  return (
    <ContentPage
      eyebrow="privacy policy"
      title="privacy policy"
      intro="ip2p is built to see as little of your data as possible. this policy covers what we do collect and why."
      sections={[
        { heading: 'information we collect', body: ['account details you provide: username, and email if you choose to add one (used only for password reset and critical security alerts).', 'trade and dispute activity: offers, trade requests, chat messages, payment instructions and their change history, and evidence you upload. Authorized dispute staff can view these records.', 'technical logs: ip address and device/browser information, kept for security purposes such as detecting new-device logins and rate-limiting abuse.', 'public wallet addresses derived from your account, used to monitor deposits and balances \u2014 never your private keys.'] },
        { heading: 'information we never collect', body: ['your recovery phrase or private keys, in readable form. what reaches our servers is already encrypted in your browser before it\u2019s sent; we do not have the means to decrypt it.', 'we never receive the fiat payment itself; you pay your counterparty directly.'] },
        { heading: 'how we use your information', body: ['to operate the marketplace and escrow system, detect and prevent fraud or abuse, respond to support requests and disputes, and send the account security notifications described in our security page.'] },
        { heading: 'third parties', body: ['we use blockchain data providers to check balances and transaction confirmations on-chain \u2014 this only involves public wallet addresses, not your identity. we do not sell your data or share it with advertisers.'] },
        { heading: 'your choices', body: ['account deletion has a seven-day grace period and waits for open trades to finish. Personal account and support data are removed. Encrypted wallet backups and minimized authentication records remain; shared trade evidence stays while the counterparty account exists. Encrypted backups expire under the published backup schedule. Public blockchain records cannot be deleted.'] },
        { heading: 'contact', body: ['questions about this policy can be sent through the support page.'] },
      ]}
    />
  );
}
