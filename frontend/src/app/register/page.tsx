'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton, VtTextField, VtErrorText, VtStamp } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtSage, vtLine, vtSurfaceDeep, vtMono } from '@/components/vtTokens';
import { generateMnemonic } from '@/lib/crypto/mnemonic';
import { deriveKeyAndVerifier } from '@/lib/crypto/kdf';
import { randomIv, randomSalt, ownerAad, encryptBlob } from '@/lib/crypto/aesGcm';
import { bytesToBase64 } from '@/lib/crypto/base64';
import { deriveRecoveryAddress } from '@/lib/crypto/recoveryKey';
import { checkUsername, getRecommendedKdfParams, register, confirmSeed } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';
import { RevealScreen, ConfirmScreen } from '@/components/SeedConfirm';
import { isPasswordPwned, PWNED_MESSAGE } from '@/lib/crypto/pwned';

type Step = 'form' | 'reveal' | 'confirm' | 'done';


export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('form');

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mnemonic, setMnemonic] = useState('');
  const words = mnemonic ? mnemonic.split(' ') : [];

  const formValid = username.length >= 3 && password.length >= 12 && password === confirmPw;

  const handleSubmit = async () => {
    setError(null);
    if (!formValid) return;
    setBusy(true);
    try {
      const avail = await checkUsername(username);
      if (!avail.available) {
        setError('that username is taken.');
        setBusy(false);
        return;
      }

      const kdfParams = await getRecommendedKdfParams();

      if (await isPasswordPwned(password)) {
        setError(PWNED_MESSAGE);
        return;
      }

      const phrase = generateMnemonic();
      const salt = randomSalt();
      const { encKey, verifier } = await deriveKeyAndVerifier(password, salt, kdfParams);
      const iv = randomIv();
      const plaintext = new TextEncoder().encode(phrase);
      const blob = await encryptBlob(plaintext, encKey, iv, ownerAad(username));
      const recoveryAddress = deriveRecoveryAddress(phrase);

      await register({
        username,
        email: email || undefined,
        verifier: bytesToBase64(verifier),
        salt: bytesToBase64(salt),
        iv: bytesToBase64(iv),
        blob: bytesToBase64(blob),
        kdf_params: kdfParams,
        recovery_address: recoveryAddress,
      });

      setMnemonic(phrase);
      setStep('reveal');
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
          <VtEyebrow>new account</VtEyebrow>
          <h1 style={titleStyle}>open an ip2p account</h1>
          <p style={subStyle}>
            we generate your recovery phrase in this browser. we never see it, and we can't recover it for you.
          </p>
          <VtTextField label="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <VtTextField label="email (optional — needed for password reset)" value={email} onChange={(e) => setEmail(e.target.value)} />
          <VtTextField label="password (12 characters minimum)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <VtTextField label="confirm password" type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          {error && <VtErrorText>{error}</VtErrorText>}
          <div style={{ marginTop: 6 }}>
            <VtButton disabled={!formValid || busy} onClick={handleSubmit}>
              {busy ? 'working…' : 'generate my recovery phrase'}
            </VtButton>
          </div>
        </VtPanel>
      )}

      {step === 'reveal' && (
        <RevealScreen words={words} onContinue={() => setStep('confirm')} />
      )}

      {step === 'confirm' && (
        <ConfirmScreen
          words={words}
          onDone={async () => {
            await confirmSeed();
            setMnemonic('');
            setStep('done');
          }}
          onReshow={() => setStep('reveal')}
        />
      )}

      {step === 'done' && (
        <VtPanel>
          <VtEyebrow>complete</VtEyebrow>
          <h1 style={titleStyle}>account active</h1>
          <VtStamp>verified<br />12 of 12</VtStamp>
          <p style={{ ...subStyle, textAlign: 'center' }}>your account is ready. your recovery phrase never left this browser.</p>
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

function humanizeError(e: ApiError): string {
  const map: Record<string, string> = {
    username_taken: 'that username is taken.',
    email_taken: 'that email is already in use.',
    invalid_input: 'please check the form and try again.',
    kdf_params_below_floor: 'the server rejected the encryption parameters. try again.',
  };
  return map[e.body?.error] ?? 'something went wrong. try again.';
}
