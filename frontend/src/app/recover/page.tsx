'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton, VtTextField, VtErrorText, VtStamp, VtMnemonicInput } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtSage, vtMono } from '@/components/vtTokens';
import { isValidMnemonic } from '@/lib/crypto/mnemonic';
import { deriveKeyAndVerifier } from '@/lib/crypto/kdf';
import { randomIv, randomSalt, ownerAad, encryptBlob } from '@/lib/crypto/aesGcm';
import { base64ToBytes, bytesToBase64 } from '@/lib/crypto/base64';
import { signRecoveryNonce } from '@/lib/crypto/recoveryKey';
import { recoverChallenge, recoverVerify, recoverSetBlob } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';
import { isPasswordPwned, PWNED_MESSAGE } from '@/lib/crypto/pwned';

type Step = 'identity' | 'password' | 'done';

export default function RecoverPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('identity');

  const [username, setUsername] = useState('');
  const [seedWords, setSeedWords] = useState<string[]>(Array(12).fill(''));
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mnemonic, setMnemonic] = useState('');
  const [kdfParams, setKdfParams] = useState<any>(null);
  const [recoveryGrant, setRecoveryGrant] = useState('');

  const handleVerify = async () => {
    setError(null);
    const phrase = seedWords.join(' ').trim();
    if (!username) { setError('enter your username.'); return; }
    if (!isValidMnemonic(phrase)) { setError("that recovery phrase doesn't look right."); return; }

    setBusy(true);
    try {
      const challenge = await recoverChallenge(username);
      const nonce = base64ToBytes(challenge.nonce);
      const signature = await signRecoveryNonce(phrase, nonce);
      const res = await recoverVerify(username, signature);

      setMnemonic(phrase);
      setKdfParams(res.kdf_params);
      setRecoveryGrant(res.recovery_grant);
      setStep('password');
    } catch (e) {
      setError('that phrase does not match this username. check both and try again.');
    } finally {
      setBusy(false);
    }
  };

  const passwordOk = password.length >= 12 && password === confirmPw;

  const handleSetPassword = async () => {
    setError(null);
    if (!passwordOk) return;
    setBusy(true);
    try {
      const salt = randomSalt();
      if (await isPasswordPwned(password)) {
        setError(PWNED_MESSAGE);
        setBusy(false);
        return;
      }
      const { encKey, verifier } = await deriveKeyAndVerifier(password, salt, kdfParams);
      const iv = randomIv();
      const blob = await encryptBlob(new TextEncoder().encode(mnemonic), encKey, iv, ownerAad(username));

      await recoverSetBlob({
        recovery_grant: recoveryGrant,
        new_verifier: bytesToBase64(verifier),
        new_salt: bytesToBase64(salt),
        new_iv: bytesToBase64(iv),
        new_blob: bytesToBase64(blob),
        new_kdf_params: kdfParams,
      });

      setMnemonic('');
      setStep('done');
    } catch {
      setError('could not save your new password. try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell section="Accounts & Keys">
      {step === 'identity' && (
        <VtPanel>
          <VtEyebrow>recover with seed phrase</VtEyebrow>
          <h1 style={titleStyle}>recover your account</h1>
          <p style={subStyle}>
            this recovers both your account and your wallets — no password, no email needed.
          </p>
          <VtTextField label="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <p style={{ ...subStyle, marginTop: 6, marginBottom: 10 }}>your 12-word recovery phrase, in order:</p>
          <VtMnemonicInput words={seedWords} onChange={setSeedWords} />
          {error && <VtErrorText>{error}</VtErrorText>}
          <VtButton disabled={busy} onClick={handleVerify}>
            {busy ? 'verifying…' : 'verify and continue'}
          </VtButton>
        </VtPanel>
      )}

      {step === 'password' && (
        <VtPanel>
          <VtEyebrow>recover with seed phrase</VtEyebrow>
          <h1 style={titleStyle}>set a new password</h1>
          <VtStamp>identity<br />verified</VtStamp>
          <VtTextField label="new password (12 characters minimum)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <VtTextField label="confirm new password" type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          {error && <VtErrorText>{error}</VtErrorText>}
          <VtButton disabled={!passwordOk || busy} onClick={handleSetPassword}>
            {busy ? 'working…' : 'set password and finish'}
          </VtButton>
        </VtPanel>
      )}

      {step === 'done' && (
        <VtPanel>
          <VtEyebrow>complete</VtEyebrow>
          <h1 style={titleStyle}>account recovered</h1>
          <VtStamp>wallets<br />intact</VtStamp>
          <p style={{ ...subStyle, textAlign: 'center' }}>
            your account and wallets are both recovered. all other sessions were signed out.
          </p>
          <VtButton onClick={() => router.push('/login')}>continue to log in →</VtButton>
        </VtPanel>
      )}
    </AppShell>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Fraunces', Georgia, serif", fontSize: 21, fontWeight: 700,
  color: vtInk, margin: '0 0 12px', textTransform: 'lowercase',
};
const subStyle: React.CSSProperties = { fontFamily: vtMono, fontSize: 12, color: vtInkDim, margin: '0 0 18px', lineHeight: 1.6 };
