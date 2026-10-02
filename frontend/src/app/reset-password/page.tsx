'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell, VtPanel } from '@/components/AppShell';
import { VtEyebrow, VtButton, VtTextField, VtErrorText, VtTextLink, VtStamp, VtMnemonicInput } from '@/components/vtUi';
import { vtInk, vtInkDim, vtGold, vtSage, vtErr, vtMono } from '@/components/vtTokens';
import { generateMnemonic, isValidMnemonic } from '@/lib/crypto/mnemonic';
import { deriveKeyAndVerifier } from '@/lib/crypto/kdf';
import { randomIv, randomSalt, ownerAad, encryptBlob } from '@/lib/crypto/aesGcm';
import { bytesToBase64 } from '@/lib/crypto/base64';
import { deriveRecoveryAddress } from '@/lib/crypto/recoveryKey';
import { passwordResetValidate, passwordResetConfirm } from '@/lib/api/auth';
import { isPasswordPwned, PWNED_MESSAGE } from '@/lib/crypto/pwned';
import { ApiError } from '@/lib/api/client';

type Mode = 'choose' | 'with-seed' | 'without-seed';

function ResetPasswordInner() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';

  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [username, setUsername] = useState('');
  const [kdfParams, setKdfParams] = useState<any>(null);

  const [mode, setMode] = useState<Mode>('choose');
  const [seedWords, setSeedWords] = useState<string[]>(Array(12).fill(''));
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totpRequired, setTotpRequired] = useState(false);
  const [secondFactor, setSecondFactor] = useState('');
  const [done, setDone] = useState<'kept-wallets' | 'new-wallets' | null>(null);

  useEffect(() => {
    if (!token) { setChecking(false); return; }
    passwordResetValidate(token)
      .then((res) => {
        if (res.valid && res.username && res.kdf_params) {
          setValid(true);
          setUsername(res.username);
          setKdfParams(res.kdf_params);
          setTotpRequired(!!res.totp_required);
        }
      })
      .finally(() => setChecking(false));
  }, [token]);

  const passwordOk = password.length >= 12 && password === confirmPw;

  const submit = async () => {
    setError(null);
    if (!passwordOk) return;

    let phrase: string;
    if (mode === 'with-seed') {
      phrase = seedWords.join(' ').trim();
      if (!isValidMnemonic(phrase)) {
        setError("that recovery phrase doesn't look right. check the words and try again.");
        return;
      }
    } else {
      phrase = generateMnemonic();
    }

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
      const blob = await encryptBlob(new TextEncoder().encode(phrase), encKey, iv, ownerAad(username));
      const recoveryAddress = deriveRecoveryAddress(phrase);

      await passwordResetConfirm({
        token,
        new_verifier: bytesToBase64(verifier),
        new_salt: bytesToBase64(salt),
        new_iv: bytesToBase64(iv),
        new_blob: bytesToBase64(blob),
        new_kdf_params: kdfParams,
        new_recovery_address: recoveryAddress,
        ...(totpRequired
          ? (/^\d{6}$/.test(secondFactor.trim()) ? { totp_code: secondFactor.trim() } : { recovery_code: secondFactor.trim() })
          : {}),
      });

      setDone(mode === 'with-seed' ? 'kept-wallets' : 'new-wallets');
    } catch (e) {
      setError(e instanceof ApiError ? 'could not reset your password. the link may have expired.' : 'could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  if (checking) return <AppShell section="Accounts & Keys"><VtPanel><p style={subStyle}>checking your link…</p></VtPanel></AppShell>;

  if (!token || !valid) {
    return (
      <AppShell section="Accounts & Keys">
        <VtPanel>
          <VtEyebrow>password reset</VtEyebrow>
          <h1 style={titleStyle}>link expired</h1>
          <p style={subStyle}>this reset link is invalid or has expired. request a new one.</p>
          <VtButton onClick={() => router.push('/forgot-password')}>request a new link</VtButton>
        </VtPanel>
      </AppShell>
    );
  }
  if (done) {
    return (
      <AppShell section="Accounts & Keys">
        <VtPanel>
          <VtEyebrow>complete</VtEyebrow>
          <h1 style={titleStyle}>password reset</h1>
          <VtStamp color={done === 'kept-wallets' ? vtSage : vtErr}>
            {done === 'kept-wallets' ? 'wallets\nrecovered' : 'new wallets\ngenerated'}
          </VtStamp>
          <p style={{ ...subStyle, textAlign: 'center' }}>
            {done === 'kept-wallets'
              ? 'your account and your existing wallets are both back. all other sessions were signed out.'
              : "your account is back, but your old wallets are not — you'll need the old password to reach them. all other sessions were signed out."}
          </p>
          <VtButton onClick={() => router.push('/login')}>continue to log in →</VtButton>
        </VtPanel>
      </AppShell>
    );
  }

  return (
    <AppShell section="Accounts & Keys">
      <VtPanel>
        <VtEyebrow>password reset — {username}</VtEyebrow>
        <h1 style={titleStyle}>set a new password</h1>

        {mode === 'choose' && (
          <>
            <p style={subStyle}>
              resetting your password does not recover your crypto. if you don't have your
              recovery phrase, your existing wallets will become inaccessible.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <VtButton onClick={() => setMode('with-seed')}>i have my recovery phrase</VtButton>
              <VtButton variant="outline" onClick={() => setMode('without-seed')}>i don't have it</VtButton>
            </div>
          </>
        )}

        {mode !== 'choose' && (
          <>
            {mode === 'with-seed' && (
              <>
                <p style={subStyle}>enter your 12-word recovery phrase, in order.</p>
                <VtMnemonicInput words={seedWords} onChange={setSeedWords} />
              </>
            )}
            {mode === 'without-seed' && (
              <p style={subStyle}>
                a new recovery phrase will be generated. your existing wallets stay put — you'd need
                the old password to reach them again.
              </p>
            )}
            <VtTextField label="new password (12 characters minimum)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <VtTextField label="confirm new password" type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
            {totpRequired && (
              <VtTextField
                label="two-factor code (or a recovery code)"
                value={secondFactor}
                onChange={(e) => setSecondFactor(e.target.value)}
              />
            )}
            {error && <VtErrorText>{error}</VtErrorText>}
            <VtButton disabled={!passwordOk || busy} onClick={submit}>
              {busy ? 'working…' : 'reset password'}
            </VtButton>
            <div style={{ marginTop: 14 }}>
              <VtTextLink onClick={() => setMode('choose')}>back</VtTextLink>
            </div>
          </>
        )}
      </VtPanel>
    </AppShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Fraunces', Georgia, serif", fontSize: 21, fontWeight: 700,
  color: vtInk, margin: '0 0 12px', textTransform: 'lowercase',
};
const subStyle: React.CSSProperties = { fontFamily: vtMono, fontSize: 12, color: vtInkDim, margin: '0 0 18px', lineHeight: 1.6 };
