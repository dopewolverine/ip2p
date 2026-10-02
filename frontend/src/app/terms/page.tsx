'use client';

import React from 'react';
import { ContentPage } from '@/components/ContentPage';

export default function TermsPage() {
  return (
    <ContentPage
      eyebrow="terms of service"
      title="terms of service"
      sections={[
        { heading: '1. what ip2p is', body: ['ip2p is a peer-to-peer marketplace that helps two users trade cryptocurrency for fiat currency, using a multi-signature escrow to hold the crypto side of the trade until both parties are satisfied. iP2P does not hold, control, or transmit fiat currency \u2014 the fiat leg of every trade is arranged directly between the two users, off-platform.'] },
        { heading: '2. eligibility', body: ['you must be able to form a binding contract under the laws of your jurisdiction to use iP2P, and you\u2019re responsible for complying with local laws regarding cryptocurrency trading.'] },
        { heading: '3. your account and recovery phrase', body: ['you are solely responsible for safeguarding your password and your recovery phrase. iP2P cannot recover a lost recovery phrase and cannot reverse a transaction once it\u2019s been signed and broadcast.'] },
        { heading: '4. escrow and disputes', body: ['when you enter a trade, you agree that the crypto side will be held in a 2-of-3 multisig address until release or refund conditions are met. in the event of a dispute, you agree that iP2P staff may review chat logs, evidence, and transaction history, and that iP2P\u2019s owner has final authority to decide the outcome.'] },
        { heading: '5. fees', body: ['applicable fees are shown before you accept a trade or confirm a release. continuing past that point constitutes acceptance of the fee.'] },
        { heading: '6. prohibited use', body: ['you may not use iP2P for any unlawful purpose, including but not limited to fraud, money laundering, or trading in connection with stolen funds or illegal goods and services. iP2P may suspend or terminate accounts suspected of violating this.'] },
        { heading: '7. no investment advice', body: ['nothing on iP2P constitutes financial, investment, or legal advice. cryptocurrency values are volatile and trading carries risk you accept on your own judgment.'] },
        { heading: '8. limitation of liability', body: ['iP2P provides the platform "as is." to the fullest extent permitted by law, iP2P is not liable for losses arising from your own loss of credentials or recovery phrase, from third-party actions (including your trading counterparty), or from blockchain network conditions outside our control.'] },
        { heading: '9. changes to these terms', body: ['we may update these terms from time to time; continued use of iP2P after a change constitutes acceptance of the updated terms.'] },
      ]}
    />
  );
}
