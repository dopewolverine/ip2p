const ROOT = require('path').resolve(__dirname, '../..') + '/';
const B = ROOT + 'backend/node_modules/';
const { argon2id } = require(B + '@noble/hashes/argon2');
const crypto = require('crypto');
const ethers = require(B + 'ethers');
const bitcoin = require(B + 'bitcoinjs-lib');
const ecc = require(B + '@bitcoinerlab/secp256k1');
const { BIP32Factory } = require(B + 'bip32');
const { authenticator } = require(B + 'otplib');
const { Client } = require(B + 'pg');
const { execSync } = require('child_process');
const fs = require('fs');
bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const API = process.env.API_URL || 'http://localhost:4100', MOCK = 'http://127.0.0.1:5999', NET = bitcoin.networks.testnet;
const db = new Client({ connectionString: (process.env.TEST_SUPERUSER_DB_URL || 'postgres://postgres:pg@localhost:5432/ip2p') });
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x).slice(0, 400)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.get('set-cookie'); const m = sc && /^([^=]+)=([^;]+)/.exec(sc);
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: m ? `${m[1]}=${m[2]}` : null };
}
const mock = (body) => fetch(MOCK + '/__set', { method: 'POST', body: JSON.stringify(body) });
const KDF = { alg: 'argon2id', m: 19456, t: 2, p: 1, version: 1 };
const derive = (pw, salt, p = KDF) => Buffer.from(argon2id(Buffer.from(pw), Buffer.from(salt, 'base64'), { t: p.t, m: p.m, p: p.p, dkLen: 64 }).slice(32)).toString('base64');
const b64 = (n) => crypto.randomBytes(n).toString('base64');
const newPhrase = () => ethers.Mnemonic.entropyToPhrase(crypto.randomBytes(16));
const recoveryWallet = (p) => ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(p), "m/44'/60'/100'/0/0");
const seedNode = (p) => bip32.fromSeed(Buffer.from(ethers.Mnemonic.fromPhrase(p).computeSeed().slice(2), 'hex'), NET);
const payout = (p) => bitcoin.payments.p2wpkh({ pubkey: Buffer.from(seedNode(p).derivePath("m/84'/1'/0'/0/0").publicKey), network: NET }).address;
const signer = (node) => ({ publicKey: Buffer.from(node.publicKey), sign: (h) => Buffer.from(ecc.sign(h, node.privateKey)) });
const blobFields = (pw, prefix = '') => { const salt = b64(16); return { [prefix + 'verifier']: derive(pw, salt), [prefix + 'salt']: salt, [prefix + 'iv']: b64(12), [prefix + 'blob']: b64(80), [prefix + 'kdf_params']: KDF }; };

async function register(username, password, email) {
  const phrase = newPhrase();
  const r = await call('POST', '/auth/register', { body: { username, email, ...blobFields(password), recovery_address: recoveryWallet(phrase).address } });
  return { ...r, phrase, password, username };
}
async function login(id, pw) {
  const s = await call('POST', '/auth/login/salt', { body: { username_or_email: id } });
  const r = await call('POST', '/auth/login', { body: { username_or_email: id, verifier: derive(pw, s.data.salt, s.data.kdf_params) } });
  return { ...r, salt: s.data };
}
async function activeUser(name) {
  const u = await register(name, 'pw-' + name + '-Long-1', `${name}@example.com`);
  await call('POST', '/auth/register/confirm-seed', { cookie: u.cookie });
  const { rows } = await db.query('SELECT id FROM users WHERE username = $1', [name]);
  return { ...u, id: rows[0].id };
}

(async () => {
  await db.connect();
  const sfx = crypto.randomBytes(3).toString('hex');
  console.log('AUTH');
  const alice = await register('alice' + sfx, 'correct horse battery 1', `alice${sfx}@example.com`);
  check('register -> 201 pending', alice.status === 201 && alice.data.status === 'pending_seed_confirmation', alice);
  let r = await call('GET', '/wallet/addresses', { cookie: alice.cookie });
  check('pending account blocked from wallet routes', r.status === 403, r);
  r = await call('POST', '/auth/login/salt', { body: { username_or_email: `alice${sfx}@example.com` } });
  check('login/salt does not reveal the username', r.status === 200 && !('username' in r.data) && !!r.data.salt, r.data);
  const l = await login(`alice${sfx}@example.com`, alice.password);
  check('pending account can log back in (resume seed confirmation)', l.status === 200 && l.data.account_status === 'pending_seed_confirmation', l);
  r = await call('POST', '/auth/register/confirm-seed', { cookie: l.cookie });
  check('confirm-seed -> active', r.status === 200 && r.data.status === 'active', r);
  let aliceCookie = l.cookie;
  r = await call('POST', '/auth/recover/set-blob', { cookie: aliceCookie, body: { recovery_grant: 'x'.repeat(40), ...blobFields('new password 22', 'new_') } });
  check('set-blob with a session but no recovery grant -> refused', r.status === 403, r);

  // Seed recovery -> single-use grant
  let ch = await call('POST', '/auth/recover/challenge', { body: { username: alice.username } });
  let sig = await recoveryWallet(alice.phrase).signMessage(Buffer.from(ch.data.nonce, 'base64'));
  r = await call('POST', '/auth/recover/verify', { body: { username: alice.username, signature: sig } });
  check('seed recovery verify -> grant', r.status === 200 && !!r.data.recovery_grant, r);
  const grant = r.data.recovery_grant, recCookie = r.cookie;
  alice.password = 'recovered password 33';
  r = await call('POST', '/auth/recover/set-blob', { cookie: recCookie, body: { recovery_grant: grant, ...blobFields(alice.password, 'new_') } });
  check('set-blob with grant -> ok', r.status === 200, r);
  r = await call('POST', '/auth/recover/set-blob', { cookie: recCookie, body: { recovery_grant: grant, ...blobFields('again 44', 'new_') } });
  check('recovery grant is single-use', r.status === 403, r);
  let li = await login(alice.username, alice.password);
  check('login with recovered password', li.status === 200, li);
  aliceCookie = li.cookie;

  // Change password
  r = await call('POST', '/auth/password/change', { cookie: aliceCookie, body: { verifier: b64(32), ...blobFields('changed 55', 'new_') } });
  check('password change with wrong current password -> 401', r.status === 401, r);
  const cur = derive(alice.password, li.salt.salt, li.salt.kdf_params);
  r = await call('POST', '/auth/password/change', { cookie: aliceCookie, body: { verifier: cur, ...blobFields('changed password 55', 'new_') } });
  check('password change with current password -> ok', r.status === 200, r);
  alice.password = 'changed password 55';
  li = await login(alice.username, alice.password); aliceCookie = li.cookie;
  check('login with the changed password', li.status === 200, li);

  // 2FA then email reset needs a second factor
  r = await call('POST', '/auth/totp/setup', { cookie: aliceCookie });
  const secret = r.data.secret;
  r = await call('POST', '/auth/totp/enable', { cookie: aliceCookie, body: { setup_token: r.data.setup_token, code: authenticator.generate(secret), verifier: derive(alice.password, li.salt.salt, li.salt.kdf_params) } });
  check('2FA enabled', r.status === 200 && r.data.recovery_codes?.length > 0, r);
  const codes = r.data.recovery_codes;
  r = await call('POST', '/auth/password-reset/request', { body: { email: `alice${sfx}@example.com` } });
  await sleep(500);
  const tokens = [...fs.readFileSync((process.env.SERVER_LOG || require('path').join(__dirname, 'server.log')), 'utf8').matchAll(/reset-password\?token=([A-Za-z0-9_\-.%]+)/g)];
  const token = decodeURIComponent(tokens[tokens.length - 1][1]);
  r = await call('GET', `/auth/password-reset/validate?token=${encodeURIComponent(token)}`);
  check('reset validate says 2FA required', r.data?.valid === true && r.data?.totp_required === true, r);
  const newReset = { token, ...blobFields('reset password 66', 'new_'), new_recovery_address: recoveryWallet(newPhrase()).address };
  r = await call('POST', '/auth/password-reset/confirm', { body: newReset });
  check('email reset WITHOUT 2FA code refused (was a 2FA bypass)', r.status === 401 || r.status === 403, r);
  r = await call('POST', '/auth/password-reset/confirm', { body: { ...newReset, recovery_code: codes[0] } });
  check('email reset with a 2FA recovery code -> ok', r.status === 200, r);
  r = await call('GET', '/auth/me', { cookie: aliceCookie });
  check('reset revoked existing sessions', r.status === 401, r.status);

  // Bans hold
  const bob = await activeUser('bob' + sfx);
  await db.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [bob.id]);
  r = await call('GET', '/auth/me', { cookie: bob.cookie });
  check('disabled user: existing session refused', r.status === 403 || r.status === 401, r);
  const { rows: revoked } = await db.query('SELECT count(*)::int n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL', [bob.id]);
  check('disabled user: sessions revoked', revoked[0].n === 0, revoked);
  ch = await call('POST', '/auth/recover/challenge', { body: { username: bob.username } });
  sig = await recoveryWallet(bob.phrase).signMessage(Buffer.from(ch.data.nonce, 'base64'));
  r = await call('POST', '/auth/recover/verify', { body: { username: bob.username, signature: sig } });
  check('disabled user: seed recovery refused', r.status !== 200, r);

  // Staff without 2FA
  const eve = await activeUser('eve' + sfx);
  await db.query(`UPDATE users SET role = 'owner' WHERE id = $1`, [eve.id]);
  r = await call('GET', '/admin/escrow/disputes', { cookie: eve.cookie });
  check('owner role without 2FA -> no admin access', r.status === 403, r);
  const t0 = Date.now();
  r = await call('GET', '/escrow/contracts/not-a-uuid', { cookie: eve.cookie });
  check('malformed id -> 400 (no hang)', r.status === 400 && Date.now() - t0 < 2000, r);

  console.log('ESCROW (BTC testnet, mocked provider)');
  const root = bip32.fromSeed(crypto.randomBytes(32), NET);
  const tpub = root.derivePath("m/45'/1'").neutered().toBase58();
  execSync(`npx ts-node --transpile-only scripts/insertPlatformKey.ts bitcoin ${tpub} "m/45'/1'"`, { cwd: ROOT + 'backend', env: { ...process.env, IP2P_NETWORK: 'testnet', MIGRATE_DATABASE_URL: (process.env.TEST_SUPERUSER_DB_URL || 'postgres://postgres:pg@localhost:5432/ip2p') }, stdio: 'pipe' });
  const vic = await activeUser('vic' + sfx), cat = await activeUser('cat' + sfx);
  r = await call('POST', '/escrow/contracts', { cookie: vic.cookie, body: { counterparty_id: cat.id, crypto_side: 'vendor', asset: 'BTC', amount: '100000', fiat_currency_code: 'USD', fiat_amount: '50', price_snapshot: '50000', payment_window_hours: 2 } });
  check('engine contract created', r.status === 201, r);
  const cid = r.data.id;
  r = await call('POST', `/escrow/contracts/${cid}/accept`, { cookie: vic.cookie, body: {} });
  check('accepted', r.data?.state === 'accepted', r);
  const { rows: acc } = await db.query('SELECT accepted_at FROM contracts WHERE id = $1', [cid]);
  check('accepted_at recorded (timer would otherwise cancel within a minute)', !!acc[0].accepted_at);
  r = await call('POST', `/trades/${cid}/payment-details`, { cookie: vic.cookie, body: { details: 'IBAN DE89 3704 0044 0532 0130 00, jane@example.com' } });
  check('crypto side sets payment details', r.status === 200, r);
  r = await call('GET', `/escrow/contracts/${cid}`, { cookie: cat.cookie });
  check('fiat side cannot see payment details before funding', r.data.payment_details === null, r.data.payment_details);
  const idx = Number(r.data.contract_index), path = `m/45'/1'/${idx}'`;
  const vKey = seedNode(vic.phrase).derivePath(path), cKey = seedNode(cat.phrase).derivePath(path);
  r = await call('POST', `/escrow/contracts/${cid}/keys`, { cookie: cat.cookie, body: { public_key: Buffer.from(cKey.publicKey).toString('hex'), derivation_path: `m/45'/0'/${idx}'`, payout_address: payout(cat.phrase) } });
  check('non-canonical derivation path refused', r.status === 400 && r.data.error === 'unexpected_derivation_path', r);
  r = await call('POST', `/escrow/contracts/${cid}/keys`, { cookie: cat.cookie, body: { public_key: Buffer.from(cKey.publicKey).toString('hex'), derivation_path: path, payout_address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' } });
  check('mainnet payout address refused on testnet', r.status === 400 && r.data.error === 'invalid_payout_address', r);
  r = await call('POST', `/escrow/contracts/${cid}/keys`, { cookie: vic.cookie, body: { public_key: Buffer.from(vKey.publicKey).toString('hex'), derivation_path: path, payout_address: payout(vic.phrase) } });
  check('vendor key recorded (bigint contract_index handled)', r.status === 200 && r.data.status === 'key_recorded', r);
  r = await call('POST', `/escrow/contracts/${cid}/keys`, { cookie: cat.cookie, body: { public_key: Buffer.from(cKey.publicKey).toString('hex'), derivation_path: path, payout_address: payout(cat.phrase) } });
  check('escrow address generated', r.status === 200 && r.data.status === 'address_generated', r);
  const escrow = r.data.escrow_address, required = BigInt(r.data.required_funding), reserve = BigInt(r.data.network_reserve);
  const pk = Buffer.from(root.derivePath(`m/45'/1'/${idx}`).publicKey);
  const sorted = [Buffer.from(vKey.publicKey), Buffer.from(cKey.publicKey), pk].sort(Buffer.compare);
  const expected = bitcoin.payments.p2wsh({ redeem: bitcoin.payments.p2ms({ m: 2, pubkeys: sorted, network: NET }), network: NET }).address;
  check('escrow address independently reproduced from the 3 keys', escrow === expected, { escrow, expected });
  check('required funding = amount + 3% fee + network reserve', required === 100000n + 3000n + reserve && reserve > 0n, { required: String(required), reserve: String(reserve) });

  const fundTx = (value) => { const t = new bitcoin.Transaction(); t.version = 2; t.addInput(crypto.randomBytes(32), 0); t.addOutput(bitcoin.address.toOutputScript(escrow, NET), Number(value)); return t; };
  const small = fundTx(required - 1n);
  await mock({ utxos: { [escrow]: [{ txid: small.getId(), vout: 0, value: String(required - 1n), confirmations: 3 }] }, txs: { [small.getId()]: small.toHex() } });
  await sleep(3500);
  r = await call('GET', `/escrow/contracts/${cid}`, { cookie: vic.cookie });
  const { rows: un } = await db.query(`SELECT 1 FROM notifications WHERE contract_id = $1 AND type = 'escrow_underfunded'`, [cid]);
  check('underfunded: stays accepted, funder notified', r.data.state === 'accepted' && un.length === 1, { state: r.data.state, n: un.length });
  const full = fundTx(required);
  await mock({ utxos: { [escrow]: [{ txid: full.getId(), vout: 0, value: String(required), confirmations: 1 }] }, txs: { [full.getId()]: full.toHex() } });
  await sleep(3500);
  r = await call('GET', `/escrow/contracts/${cid}`, { cookie: vic.cookie });
  check('1 confirmation: timer frozen, not yet funded', r.data.state === 'accepted' && r.data.funding_txid === full.getId(), { state: r.data.state, f: r.data.funding_txid });
  await mock({ utxos: { [escrow]: [{ txid: full.getId(), vout: 0, value: String(required), confirmations: 3 }] } });
  await sleep(3500);
  r = await call('GET', `/escrow/contracts/${cid}`, { cookie: cat.cookie });
  check('3 confirmations: funded', r.data.state === 'funded' && !!r.data.funded_at, r.data.state);
  check('fiat side sees payment details once funded', typeof r.data.payment_details === 'string' && r.data.payment_details.includes('IBAN'), r.data.payment_details);
  r = await call('POST', `/escrow/contracts/${cid}/mark-paid`, { cookie: cat.cookie, body: {} });
  const { rows: pr } = await db.query('SELECT state, paid_at FROM contracts WHERE id = $1', [cid]);
  check('marked paid, paid_at recorded', pr[0].state === 'paid' && !!pr[0].paid_at, pr[0]);

  r = await call('POST', `/escrow/contracts/${cid}/proposals`, { cookie: cat.cookie, body: { purpose: 'release' } });
  check('release proposal built by server', r.status === 200 && !!r.data.psbt, r);
  const psbt0 = bitcoin.Psbt.fromBase64(r.data.psbt, { network: NET });
  const outs = psbt0.txOutputs.map((o) => ({ a: o.address, v: BigInt(o.value) }));
  check('buyer gets exactly the amount', outs.some((o) => o.a === payout(cat.phrase) && o.v === 100000n), outs.map((o) => [o.a, String(o.v)]));
  check('fee output exactly 3% to the platform address', outs.some((o) => o.a === 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx' && o.v === 3000n));
  const change = outs.find((o) => o.a === payout(vic.phrase));
  const netFee = required - outs.reduce((s, o) => s + o.v, 0n);
  check('unused reserve returns to the funder; network fee comes from the reserve', !!change && netFee > 0n && netFee < reserve && change.v === reserve - netFee, { change: change && String(change.v), netFee: String(netFee) });

  const tampered = bitcoin.Psbt.fromBase64(r.data.psbt, { network: NET });
  tampered.data.globalMap.unsignedTx.tx.outs[0].value -= 1000;
  tampered.signAllInputs(signer(vKey));
  r = await call('POST', `/escrow/contracts/${cid}/proposals/release/sign`, { cookie: vic.cookie, body: { signed_psbt: tampered.toBase64() } });
  check('signature over a different transaction refused', r.status === 400 && r.data.error === 'psbt_mismatch', r);

  const p1 = bitcoin.Psbt.fromBase64(psbt0.toBase64(), { network: NET }); p1.signAllInputs(signer(vKey));
  r = await call('POST', `/escrow/contracts/${cid}/proposals/release/sign`, { cookie: vic.cookie, body: { signed_psbt: p1.toBase64() } });
  check('first signature stored', r.status === 200 && r.data.status === 'awaiting_counterparty', r);
  r = await call('POST', `/escrow/contracts/${cid}/proposals/release/sign`, { cookie: vic.cookie, body: { signed_psbt: p1.toBase64() } });
  check('same signer twice refused', r.status === 409, r);
  r = await call('GET', `/escrow/contracts/${cid}/proposals/release`, { cookie: cat.cookie });
  const p2 = bitcoin.Psbt.fromBase64(r.data.psbt, { network: NET }); p2.signAllInputs(signer(cKey));
  await mock({ rejectBroadcast: true });
  r = await call('POST', `/escrow/contracts/${cid}/proposals/release/sign`, { cookie: cat.cookie, body: { signed_psbt: p2.toBase64() } });
  check('provider failure leaves a durable signed settlement', r.status === 200 && r.data.status === 'signed' && !!r.data.txid, r);
  const { reconcileSettlement } = require(ROOT + 'backend/dist/src/escrow/releaseProposal');
  await reconcileSettlement(cid, 'release');
  let pending = await db.query('SELECT status, last_error FROM broadcasts WHERE contract_id = $1', [cid]);
  check('ambiguous provider errors are not treated as broadcast success', pending.rows[0].status === 'signed' && pending.rows[0].last_error === 'broadcast_unverified', pending.rows[0]);
  await mock({ rejectBroadcast: false });
  await reconcileSettlement(cid, 'release');
  const sent = await (await fetch(MOCK + '/__sent')).json();
  const tx = bitcoin.Transaction.fromHex(sent[sent.length - 1]);
  check('broadcast tx spends the funding output with a 2-of-3 witness', Buffer.from(tx.ins[0].hash).reverse().toString('hex') === full.getId() && tx.ins[0].witness.length === 4 && tx.getId() === r.data.txid);
  const { rows: fin } = await db.query(`SELECT c.state, c.release_txid, b.status FROM contracts c JOIN broadcasts b ON b.contract_id = c.id WHERE c.id = $1`, [cid]);
  check('contract remains paid until confirmed; broadcast recorded', fin[0].state === 'paid' && fin[0].status === 'broadcast' && fin[0].release_txid === r.data.txid, fin[0]);
  r = await call('POST', `/escrow/contracts/${cid}/proposals`, { cookie: cat.cookie, body: { purpose: 'release' } });
  check('no second payout', r.status === 409, r);
  await mock({ conf: { [tx.getId()]: 1 } });
  await reconcileSettlement(cid, 'release');
  check('insufficient depth keeps settlement pending', (await db.query('SELECT state FROM contracts WHERE id = $1', [cid])).rows[0].state === 'paid');
  await mock({ conf: { [tx.getId()]: 3 } });
  await reconcileSettlement(cid, 'release');
  await reconcileSettlement(cid, 'release');
  const confirmed = await db.query('SELECT c.state, b.status, b.confirmed_at FROM contracts c JOIN broadcasts b ON b.contract_id=c.id WHERE c.id=$1', [cid]);
  check('confirmation closes the trade exactly once', confirmed.rows[0].state === 'released' && confirmed.rows[0].status === 'confirmed' && !!confirmed.rows[0].confirmed_at, confirmed.rows[0]);
  check('one terminal transition is recorded', Number((await db.query("SELECT count(*) FROM contract_transitions WHERE contract_id=$1 AND to_state='released'", [cid])).rows[0].count) === 1);
  r = await call('POST', `/trades/${cid}/payment-details`, { cookie: vic.cookie, body: { details: 'modified after settlement' } });
  check('payment instructions cannot change after settlement', r.status === 409, r);
  const uid = bob.id;
  await db.query("UPDATE users SET status='pending_deletion', deletion_due_at=now()-interval '1 minute' WHERE id=$1", [uid]);
  const purged = await db.query('SELECT purge_due_account($1) AS done', [uid]);
  const deleted = (await db.query('SELECT status, username, email, recovery_address, auth_hash FROM users WHERE id=$1', [uid])).rows[0];
  check('due account is anonymized', purged.rows[0].done && deleted.status==='deleted' && deleted.username===null && deleted.email===null && deleted.recovery_address===null && deleted.auth_hash==='', deleted);
  check('deleted account sessions are revoked', Number((await db.query('SELECT count(*) FROM sessions WHERE user_id=$1',[uid])).rows[0].count)===0);
  check('encrypted recovery blob is retained', Number((await db.query('SELECT count(*) FROM wallet_blobs WHERE user_id=$1',[uid])).rows[0].count)>0);
  console.log(`\n${pass} passed, ${fail} failed`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
