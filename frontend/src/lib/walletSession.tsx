'use client';

import React, { createContext, useContext, useRef, useState, useCallback } from 'react';

// Holds the decrypted mnemonic in memory for the browser session - never
// localStorage/sessionStorage (spec §6.3). This exists because sending
// funds deliberately has NO step-up/re-entry prompt (spec P1 §7.1 /
// acceptance criterion 17a: "the password is already the gate") - the
// signing key has to already be available from the login-time decrypt,
// not re-derived from a password the user is never asked for again.
//
// Cleared on logout and naturally on tab close/reload (it's just React
// state, nothing persists it) - see clear().
interface WalletSessionValue {
  mnemonic: string | null;
  setMnemonic: (phrase: string) => void;
  clear: () => void;
}

const WalletSessionContext = createContext<WalletSessionValue | null>(null);

export function WalletSessionProvider({ children }: { children: React.ReactNode }) {
  const [mnemonic, setMnemonicState] = useState<string | null>(null);

  const setMnemonic = useCallback((phrase: string) => setMnemonicState(phrase), []);
  const clear = useCallback(() => setMnemonicState(null), []);

  return (
    <WalletSessionContext.Provider value={{ mnemonic, setMnemonic, clear }}>
      {children}
    </WalletSessionContext.Provider>
  );
}

export function useWalletSession(): WalletSessionValue {
  const ctx = useContext(WalletSessionContext);
  if (!ctx) throw new Error('useWalletSession must be used within WalletSessionProvider');
  return ctx;
}
