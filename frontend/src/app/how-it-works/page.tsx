'use client';

import React from 'react';
import { ContentPage } from '@/components/ContentPage';

export default function HowItWorksPage() {
  return (
    <ContentPage
      eyebrow="how it works"
      title="how a trade works"
      sections={[
        { heading: '1. create or find an offer', body: ['browse the marketplace for offers to buy or sell crypto, or list your own with your price, payment method, and limits.'] },
        { heading: '2. request a trade', body: ['send a trade request with the amount you want. the vendor has a window to accept or decline.'] },
        { heading: '3. escrow is set up', body: ['once accepted, both sides submit a key from their wallet. this automatically generates a unique 2-of-3 escrow address for this trade only \u2014 vendor, customer, and iP2P each hold one key, and any two are needed to move the funds.'] },
        { heading: '4. funds are deposited', body: ["the funding party sends the agreed crypto to the escrow address. iP2P's monitors detect the deposit automatically \u2014 no manual confirmation needed."] },
        { heading: '5. payment is made off-platform', body: ['the buyer sends the agreed fiat payment using the payment method selected on the offer, then marks the trade as paid.'] },
        { heading: '6. funds are released', body: ['once the seller confirms the fiat payment arrived, they release the crypto. your browser verifies the exact destination and amount before you sign \u2014 nothing is sent blind.'] },
        { heading: '7. if there\u2019s a disagreement', body: ['either party can open a dispute instead of releasing. staff review the evidence and recommend an outcome; iP2P\u2019s owner makes the final call using a hardware-signed resolution.'] },
      ]}
    />
  );
}
