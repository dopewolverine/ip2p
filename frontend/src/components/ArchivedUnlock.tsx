'use client';

import React, { useState } from 'react';
import { VtSmallButton, VtTextField, VtErrorText } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtLine, vtMono } from '@/components/vtTokens';
import { me, archivedWalletBlobs } from '@/lib/api/auth';
import { deriveKeyAndVerifier } from '@/lib/crypto/kdf';
import { decryptBlob, ownerAad } from '@/lib/crypto/aesGcm';
import { base64ToBytes } from '@/lib/crypto/base64';

// P0 §7.2 - the "second chance". After an email reset without the phrase,
// the old wallets stay encrypted under the OLD password. Entering that
// password here decrypts the old recovery phrase in this browser only, so
// the funds can be moved out with any standard wallet.
export function ArchivedUnlock() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phrase, setPhrase] = useState<string | null>(null);

  const unlock = async () => {
    setBusy(true);
    setError(null);
    try {
      const { username } = await me();
      const { blobs } = await archivedWalletBlobs();
      for (const b of blobs) {
        try {
          const { encKey } = await deriveKeyAndVerifier(password, base64ToBytes(b.salt), b.kdf_params);
          const plaintext = await decryptBlob(base64ToBytes(b.blob), encKey, base64ToBytes(b.iv), ownerAad(username));
          setPhrase(new TextDecoder().decode(plaintext));
          setPassword('');
          return;
        } catch {
          // not this blob - try the next one
        }
      }
      setError(blobs.length === 0 ? 'there are no archived wallets on this account.' : 'that password does not open any archived wallet.');
    } catch {
      setError('could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  if (phrase) {
    return (
      <div style={{ border: `1px solid ${vtLine}`, borderRadius: 5, padding: 12, marginBottom: 12 }}>
        <div style={{ fontFamily: vtMono, fontSize: 11.5, color: vtInkDim, marginBottom: 8, lineHeight: 1.6 }}>
          recovery phrase of your previous wallets. import it into a wallet app (electrum for btc/ltc, metamask for eth and
          erc20 tokens, tronlink for usdt-trc20) and send the funds to your current deposit addresses. it is not stored anywhere —
          close this when you&apos;re done.
        </div>
        <div style={{ fontFamily: vtMono, fontSize: 13, color: vtGold, wordBreak: 'break-word', marginBottom: 10 }}>{phrase}</div>
        <VtSmallButton onClick={() => setPhrase(null)}>hide</VtSmallButton>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontFamily: vtMono, fontSize: 11, color: vtInk, marginBottom: 6 }}>unlock with your old password</div>
      <VtTextField label="previous password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <VtErrorText>{error}</VtErrorText>}
      <VtSmallButton onClick={unlock} disabled={!password || busy}>{busy ? 'working…' : 'unlock'}</VtSmallButton>
    </div>
  );
}
