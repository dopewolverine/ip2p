'use client';

import React, { useEffect, useState } from 'react';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton, VtTextField, VtErrorText } from '@/components/vtUi';
import { vtInk, vtInkDim, vtMono } from '@/components/vtTokens';
import { me, loginSalt, getRecommendedKdfParams, changePassword } from '@/lib/api/auth';
import { deriveKeyAndVerifier } from '@/lib/crypto/kdf';
import { randomIv, randomSalt, ownerAad, encryptBlob } from '@/lib/crypto/aesGcm';
import { base64ToBytes, bytesToBase64 } from '@/lib/crypto/base64';
import { isPasswordPwned, PWNED_MESSAGE } from '@/lib/crypto/pwned';
import { useWalletSession } from '@/lib/walletSession';
import { ApiError } from '@/lib/api/client';

// P0 §8 - change password. The same recovery phrase is re-encrypted under
// the new password in this browser; wallets and addresses don't change.
export default function ChangePasswordPage() {
  const walletSession = useWalletSession();
  const [username, setUsername] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    me().then((m) => setUsername(m.username)).catch(() => setUsername(null));
  }, []);

  const valid = current.length > 0 && next.length >= 12 && next === confirm && next !== current;

  const submit = async () => {
    if (!username || !walletSession.mnemonic || !valid) return;
    setBusy(true);
    setError(null);
    try {
      if (await isPasswordPwned(next)) {
        setError(PWNED_MESSAGE);
        return;
      }
      const saltRes = await loginSalt(username);
      const { verifier: currentVerifier } = await deriveKeyAndVerifier(current, base64ToBytes(saltRes.salt), saltRes.kdf_params);
      const kdfParams = await getRecommendedKdfParams();
      const salt = randomSalt();
      const iv = randomIv();
      const { encKey, verifier } = await deriveKeyAndVerifier(next, salt, kdfParams);
      const blob = await encryptBlob(new TextEncoder().encode(walletSession.mnemonic), encKey, iv, ownerAad(username));
      await changePassword({
        verifier: bytesToBase64(currentVerifier),
        new_verifier: bytesToBase64(verifier),
        new_salt: bytesToBase64(salt),
        new_iv: bytesToBase64(iv),
        new_blob: bytesToBase64(blob),
        new_kdf_params: kdfParams,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? 'could not change the password — check your current password.' : 'could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell section="Accounts & Keys">
      <VtPanel>
        <VtEyebrow>account</VtEyebrow>
        <h1 style={titleStyle}>change password</h1>
        {done ? (
          <p style={subStyle}>password changed. every other session has been signed out.</p>
        ) : username === null ? (
          <p style={subStyle}>sign in first.</p>
        ) : !walletSession.mnemonic ? (
          <p style={subStyle}>log in again in this tab first — your recovery phrase is re-encrypted with the new password in this browser.</p>
        ) : (
          <>
            <VtTextField label="current password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            <VtTextField label="new password (12 characters minimum)" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
            <VtTextField label="confirm new password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {error && <VtErrorText>{error}</VtErrorText>}
            <VtButton disabled={!valid || busy} onClick={submit}>{busy ? 'working…' : 'change password'}</VtButton>
          </>
        )}
      </VtPanel>
    </AppShell>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 700, color: vtInk, margin: '0 0 14px', textTransform: 'lowercase',
};
const subStyle: React.CSSProperties = { fontFamily: vtMono, fontSize: 12, color: vtInkDim, margin: '0 0 18px', lineHeight: 1.6 };
