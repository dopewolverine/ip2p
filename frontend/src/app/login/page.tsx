'use client';

import React, { useState } from 'react';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton, VtTextField, VtErrorText, VtTextLink, VtStamp } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtMono } from '@/components/vtTokens';
import { deriveKeyAndVerifier } from '@/lib/crypto/kdf';
import { base64ToBytes, bytesToBase64 } from '@/lib/crypto/base64';
import { ownerAad, decryptBlob } from '@/lib/crypto/aesGcm';
import { loginSalt, login, loginTotp, loginRecoveryCode, submitWalletAddresses, BlobPayload } from '@/lib/api/auth';
import { deriveAllWalletAddresses } from '@/lib/crypto/walletDerivation';
import { useWalletSession } from '@/lib/walletSession';
import { ApiError } from '@/lib/api/client';
import { confirmSeed } from '@/lib/api/auth';
import { RevealScreen, ConfirmScreen } from '@/components/SeedConfirm';

type Step = 'form' | 'totp' | 'done' | 'seed_reveal' | 'seed_confirm';

export default function LoginPage() {
  const [step, setStep] = useState<Step>('form');
  const [pendingWords, setPendingWords] = useState<string[]>([]);
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [encKey, setEncKey] = useState<Uint8Array | null>(null);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState<number | null>(null);
  const walletSession = useWalletSession();

  const decryptAndFinish = async (key: Uint8Array, payload: BlobPayload) => {
    const plaintext = await decryptBlob(
      base64ToBytes(payload.blob),
      key,
      base64ToBytes(payload.iv),
      ownerAad(payload.username)
    );
    const phrase = new TextDecoder().decode(plaintext);
    setWordCount(phrase.trim().split(/\s+/).length);

    walletSession.setMnemonic(phrase);

    // P0 §5.2: an account that never confirmed its phrase resumes here.
    if (payload.account_status === 'pending_seed_confirmation') {
      setPendingWords(phrase.trim().split(/\s+/));
      setEncKey(null);
      setStep('seed_reveal');
      return;
    }

    try {
      const addresses = deriveAllWalletAddresses(phrase);
      await submitWalletAddresses(addresses);
    } catch (err) {
      console.error('wallet address submission failed', err);
    }

    setEncKey(null);
    setStep('done');
  };

  const finishAfterSeedConfirm = async () => {
    await confirmSeed();
    try {
      await submitWalletAddresses(deriveAllWalletAddresses(pendingWords.join(' ')));
    } catch (err) {
      console.error('wallet address submission failed', err);
    }
    setWordCount(pendingWords.length);
    setStep('done');
  };

  const handlePasswordSubmit = async () => {
    setError(null);
    if (!usernameOrEmail || !password) return;
    setBusy(true);
    try {
      const saltRes = await loginSalt(usernameOrEmail);
      const { encKey: key, verifier } = await deriveKeyAndVerifier(password, base64ToBytes(saltRes.salt), saltRes.kdf_params);

      const res = await login(usernameOrEmail, bytesToBase64(verifier));

      if ('totp_required' in res) {
        setEncKey(key);
        setChallengeToken(res.challenge_token);
        setStep('totp');
        return;
      }

      await decryptAndFinish(key, res);
    } catch (e) {
      setError(e instanceof ApiError ? humanizeError(e) : 'Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleTotpSubmit = async () => {
    setError(null);
    if (!encKey || !challengeToken || !code) return;
    setBusy(true);
    try {
      const res = useRecoveryCode
        ? await loginRecoveryCode(challengeToken, code)
        : await loginTotp(challengeToken, code);
      await decryptAndFinish(encKey, res);
    } catch (e) {
      setError(e instanceof ApiError ? humanizeError(e) : 'Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell section="Accounts & Keys">
      {step === 'form' && (
        <VtPanel>
          <VtEyebrow>welcome back</VtEyebrow>
          <h1 style={titleStyle}>log in</h1>
          <VtTextField label="username or email" value={usernameOrEmail} onChange={(e) => setUsernameOrEmail(e.target.value)} />
          <VtTextField label="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <VtErrorText>{error}</VtErrorText>}
          <VtButton disabled={busy} onClick={handlePasswordSubmit}>
            {busy ? 'working…' : 'log in'}
          </VtButton>
        </VtPanel>
      )}

      {step === 'totp' && (
        <VtPanel>
          <VtEyebrow>two-factor</VtEyebrow>
          <h1 style={titleStyle}>enter your code</h1>
          <p style={subStyle}>
            {useRecoveryCode
              ? 'enter one of the 10 recovery codes you saved when you turned on two-factor.'
              : 'open your authenticator app and enter the current 6-digit code.'}
          </p>
          <VtTextField
            label={useRecoveryCode ? 'recovery code' : 'code'}
            inputMode={useRecoveryCode ? 'text' : 'numeric'}
            maxLength={useRecoveryCode ? 11 : 6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {error && <VtErrorText>{error}</VtErrorText>}
          <VtButton disabled={busy} onClick={handleTotpSubmit}>
            {busy ? 'working…' : 'verify'}
          </VtButton>
          <div style={{ marginTop: 14 }}>
            <VtTextLink onClick={() => { setUseRecoveryCode((v) => !v); setCode(''); setError(null); }}>
              {useRecoveryCode ? 'use my authenticator app instead' : "don't have your authenticator? use a recovery code"}
            </VtTextLink>
          </div>
        </VtPanel>
      )}

      {step === 'seed_reveal' && (
        <RevealScreen words={pendingWords} onContinue={() => setStep('seed_confirm')} />
      )}

      {step === 'seed_confirm' && (
        <ConfirmScreen words={pendingWords} onReshow={() => setStep('seed_reveal')} onDone={finishAfterSeedConfirm} />
      )}

      {step === 'done' && (
        <VtPanel>
          <VtEyebrow>signed in</VtEyebrow>
          <h1 style={titleStyle}>welcome back</h1>
          <VtStamp>decrypted<br />{wordCount} words</VtStamp>
          <p style={{ ...subStyle, textAlign: 'center' }}>
            your recovery phrase was decrypted in this browser and never sent anywhere.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', marginTop: 8 }}>
            <VtTextLink onClick={() => { window.location.href = '/wallets'; }}>view your wallets</VtTextLink>
            <VtTextLink onClick={() => { window.location.href = '/account/security'; }}>manage two-factor authentication</VtTextLink>
            <VtTextLink onClick={() => { window.location.href = '/account/password'; }}>change password</VtTextLink>
            <VtTextLink onClick={() => { window.location.href = '/account/delete'; }}>delete account</VtTextLink>
          </div>
        </VtPanel>
      )}
    </AppShell>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 700,
  color: vtInk, margin: '0 0 14px', textTransform: 'lowercase',
};
const subStyle: React.CSSProperties = { fontFamily: vtMono, fontSize: 12, color: vtInkDim, margin: '0 0 18px', lineHeight: 1.6 };

function humanizeError(e: ApiError): string {
  const map: Record<string, string> = {
    invalid_credentials: 'wrong username/email or password.',
    invalid_code: 'that code is incorrect.',
    invalid_or_expired_challenge: 'that login attempt expired. start again.',
    account_not_active: 'this account is not active.',
  };
  return map[e.body?.error] ?? 'something went wrong. try again.';
}
