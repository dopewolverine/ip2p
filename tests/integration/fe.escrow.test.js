const ROOT = require('path').resolve(__dirname, '../..') + '/';
// Runs the FRONTEND verification/signing modules against the live backend.
const B = ROOT + 'backend/node_modules/', F = ROOT + 'frontend/';
require(B + 'ts-node').register({ transpileOnly: true, skipProject: true, compilerOptions: { module: 'node16', moduleResolution: 'node16', esModuleInterop: true, target: 'es2020', jsx: 'react' } });
const crypto = require('crypto');
const { argon2id } = require(B + '@noble/hashes/argon2');
const ethers = require(B + 'ethers');
const bitcoin = require(F + 'node_modules/bitcoinjs-lib');
const ecc = require(F + 'node_modules/@bitcoinerlab/secp256k1');
const { BIP32Factory } = require(B + 'bip32');
const { Client } = require(B + 'pg');
const { execSync } = require('child_process');
bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const API = process.env.API_URL || 'http://localhost:4100', MOCK = 'http://127.0.0.1:5999', NET = bitcoin.networks.testnet;
const FEE_ADDR = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const root = bip32.fromSeed(crypto.randomBytes(32), NET);
const tpub = root.derivePath("m/45'/1'").neutered().toBase58();
Object.assign(process.env, { NEXT_PUBLIC_IP2P_NETWORK: 'testnet', NEXT_PUBLIC_PLATFORM_FEE_ADDRESS_BTC: FEE_ADDR, NEXT_PUBLIC_PLATFORM_XPUB_BTC: tpub });
const V = require(F + 'src/lib/escrow/verify.ts');
const W = require(F + 'src/lib/crypto/verifyWithdrawal.ts');
const D = require(F + 'src/lib/crypto/walletDerivation.ts');
const S = require(F + 'src/lib/crypto/signTransaction.ts');
const db = new Client({ connectionString: (process.env.TEST_SUPERUSER_DB_URL || 'postgres://postgres:pg@localhost:5432/ip2p') });
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x, (k, v) => typeof v === 'bigint' ? String(v) : v).slice(0, 500)); } };
const throwsCheck = (n, fn, expectCheck) => { try { fn(); check(n, false, 'did not throw'); } catch (e) { check(n, !expectCheck || e.check === expectCheck || e instanceof W.WithdrawalCheckError, { check: e.check, msg: e.message }); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.get('set-cookie'); const m = sc && /^([^=]+)=([^;]+)/.exec(sc);
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: m ? `${m[1]}=${m[2]}` : null };
}
const mock = (body) => fetch(MOCK + '/__set', { method: 'POST', body: JSON.stringify(body) });
const KDF = { alg: 'argon2id', m: 19456, t: 2, p: 1, version: 1 };
const derive = (pw, salt) => Buffer.from(argon2id(Buffer.from(pw), Buffer.from(salt, 'base64'), { t: 2, m: 19456, p: 1, dkLen: 64 }).slice(32)).toString('base64');
const b64 = (n) => crypto.randomBytes(n).toString('base64');
async function activeUser(name) {
  const phrase = ethers.Mnemonic.entropyToPhrase(crypto.randomBytes(16)), salt = b64(16);
  const rec = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(phrase), "m/44'/60'/100'/0/0").address;
  const r = await call('POST', '/auth/register', { body: { username: name, verifier: derive('pw-' + name + '-long', salt), salt, iv: b64(12), blob: b64(80), kdf_params: KDF, recovery_address: rec } });
  await call('POST', '/auth/register/confirm-seed', { cookie: r.cookie });
  const { rows } = await db.query('SELECT id FROM users WHERE username = $1', [name]);
  return { cookie: r.cookie, phrase, id: rows[0].id };
}
const cloneWithOut = (b64s, i, fnOut) => { const p = bitcoin.Psbt.fromBase64(b64s, { network: NET }); fnOut(p.data.globalMap.unsignedTx.tx.outs[i]); return p.toBase64(); };

(async () => {
  await db.connect();
  const sfx = crypto.randomBytes(3).toString('hex');
  execSync(`npx ts-node --transpile-only scripts/insertPlatformKey.ts bitcoin ${tpub} "m/45'/1'"`, { cwd: ROOT + 'backend', env: { ...process.env, IP2P_NETWORK: 'testnet', MIGRATE_DATABASE_URL: (process.env.TEST_SUPERUSER_DB_URL || 'postgres://postgres:pg@localhost:5432/ip2p') }, stdio: 'pipe' });
  const vic = await activeUser('fv' + sfx), cat = await activeUser('fc' + sfx);
  let r = await call('POST', '/escrow/contracts', { cookie: vic.cookie, body: { counterparty_id: cat.id, crypto_side: 'vendor', asset: 'BTC', amount: '250000', fiat_currency_code: 'USD', fiat_amount: '150', price_snapshot: '60000', payment_window_hours: 2 } });
  const cid = r.data.id;
  await call('POST', `/escrow/contracts/${cid}/accept`, { cookie: vic.cookie, body: {} });
  let c = (await call('GET', `/escrow/contracts/${cid}`, { cookie: vic.cookie })).data;
  const idx = Number(c.contract_index);
  const vk = V.deriveTradeKeys(vic.phrase, 'bitcoin', idx), ck = V.deriveTradeKeys(cat.phrase, 'bitcoin', idx);
  console.log('SETUP (frontend-derived keys accepted by backend)');
  r = await call('POST', `/escrow/contracts/${cid}/keys`, { cookie: vic.cookie, body: { public_key: vk.publicKeyHex, derivation_path: vk.path, payout_address: vk.payoutAddress } });
  check('vendor key from frontend derivation accepted', r.data?.status === 'key_recorded', r);
  r = await call('POST', `/escrow/contracts/${cid}/keys`, { cookie: cat.cookie, body: { public_key: ck.publicKeyHex, derivation_path: ck.path, payout_address: ck.payoutAddress } });
  check('escrow address generated', r.data?.status === 'address_generated', r);
  c = (await call('GET', `/escrow/contracts/${cid}`, { cookie: vic.cookie })).data;
  const keys = (await call('GET', `/escrow/contracts/${cid}/keys`, { cookie: vic.cookie })).data;
  const setupV = { chain: 'bitcoin', contractIndex: idx, myParty: 'vendor', mine: vk, keys, escrowAddress: c.escrow_address, witnessScriptHex: c.redeem_script };
  const setupC = { ...setupV, myParty: 'customer', mine: ck };
  let ok = true; try { V.verifyEscrowSetup(setupV); V.verifyEscrowSetup(setupC); } catch (e) { ok = e; }
  check('both browsers verify the escrow address (pinned platform key)', ok === true, ok && { check: ok.check, msg: ok.message });
  throwsCheck('server-substituted platform key -> refused', () => V.verifyEscrowSetup({ ...setupV, keys: { ...keys, platform: Buffer.from(root.derivePath("m/45'/1'/999").publicKey).toString('hex') } }), 'platform_key');
  throwsCheck('server-substituted escrow address -> refused', () => V.verifyEscrowSetup({ ...setupV, escrowAddress: FEE_ADDR }), 'escrow_address');
  throwsCheck('server-substituted own payout address -> refused', () => V.verifyEscrowSetup({ ...setupV, keys: { ...keys, vendor_payout: FEE_ADDR } }), 'own_payout_address');

  const required = BigInt(c.required_funding);
  const t = new bitcoin.Transaction(); t.version = 2; t.addInput(crypto.randomBytes(32), 0); t.addOutput(bitcoin.address.toOutputScript(c.escrow_address, NET), Number(required + 777n));
  await mock({ utxos: { [c.escrow_address]: [{ txid: t.getId(), vout: 0, value: String(required + 777n), confirmations: 3 }] }, txs: { [t.getId()]: t.toHex() } });
  await sleep(3500);
  await call('POST', `/escrow/contracts/${cid}/mark-paid`, { cookie: cat.cookie, body: {} });
  c = (await call('GET', `/escrow/contracts/${cid}`, { cookie: vic.cookie })).data;
  check('funded (overfunded by 777 sats) and marked paid', c.state === 'paid', c.state);

  console.log('RELEASE (server builds, browsers verify and sign)');
  const prop = (await call('POST', `/escrow/contracts/${cid}/proposals`, { cookie: vic.cookie, body: { purpose: 'release' } })).data;
  const ctr = { state: c.state, crypto_side: c.crypto_side, amount: c.amount, fee_amount: c.fee_amount, network_reserve: c.network_reserve };
  let res = null; try { res = V.verifyProposal({ ...setupV, purpose: 'release', psbtBase64: prop.psbt, contract: ctr }); } catch (e) { res = e; }
  check('seller browser verifies the server proposal', res && res.outputs, res && { check: res.check, msg: res.message });
  if (res && res.outputs) console.log('       outputs:', res.outputs.map((o) => `${o.role}=${o.value}`).join(' '), 'networkFee=' + res.networkFee);
  const fs = require('fs'), path = require('path'), os = require('os');
  const { execFileSync } = require('child_process');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ip2p-recovery-'));
  try {
    const bundle = { format:'ip2p-escrow-recovery-v1', network:'testnet', chain:'bitcoin', platform_xpub:tpub, fee_address:FEE_ADDR,
      contract_index:idx, keys, escrow_address:c.escrow_address, witness_script:c.redeem_script, ...ctr };
    fs.writeFileSync(temp+'/bundle.json',JSON.stringify(bundle));
    fs.writeFileSync(temp+'/utxos.json',JSON.stringify([{txid:t.getId(),vout:0,value:String(required+777n),rawTxHex:t.toHex()}]));
    const cli = (...args)=>execFileSync(process.execPath,[ROOT+'tools/recover-escrow.cjs',...args],{stdio:'pipe'});
    cli('build',temp+'/bundle.json',temp+'/utxos.json','release','5',temp+'/unsigned.psbt');
    cli('inspect',temp+'/bundle.json',temp+'/unsigned.psbt','release');
    const offline = fs.readFileSync(temp+'/unsigned.psbt','utf8').trim();
    fs.writeFileSync(temp+'/vendor.psbt',V.signProposal(offline,'bitcoin',vk));
    fs.writeFileSync(temp+'/customer.psbt',V.signProposal(offline,'bitcoin',ck));
    cli('combine',temp+'/bundle.json',temp+'/vendor.psbt',temp+'/customer.psbt','release',temp+'/signed.hex');
    const recovered = bitcoin.Transaction.fromHex(fs.readFileSync(temp+'/signed.hex','utf8').trim());
    check('offline recovery builds, verifies and combines a valid two-party transaction',recovered.ins[0].witness.length===4);
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
  const attacker = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(root.derivePath('m/7').publicKey), network: NET });
  throwsCheck('change redirected to an attacker -> refused', () => V.verifyProposal({ ...setupV, purpose: 'release', contract: ctr, psbtBase64: cloneWithOut(prop.psbt, 2, (o) => { o.script = attacker.output; }) }), 'extra_output');
  throwsCheck('buyer amount cut -> refused', () => V.verifyProposal({ ...setupV, purpose: 'release', contract: ctr, psbtBase64: cloneWithOut(prop.psbt, 0, (o) => { o.value -= 1000; }) }), 'recipient');
  throwsCheck('platform fee inflated -> refused', () => V.verifyProposal({ ...setupV, purpose: 'release', contract: ctr, psbtBase64: cloneWithOut(prop.psbt, 1, (o) => { o.value += 5000; }) }));
  r = await call('POST', `/escrow/contracts/${cid}/proposals/release/sign`, { cookie: vic.cookie, body: { signed_psbt: V.signProposal(prop.psbt, 'bitcoin', vk) } });
  check('seller signature (frontend signer) accepted by server', r.data?.status === 'awaiting_counterparty', r);
  const half = (await call('GET', `/escrow/contracts/${cid}/proposals/release`, { cookie: cat.cookie })).data;
  res = null; try { res = V.verifyProposal({ ...setupC, purpose: 'release', psbtBase64: half.psbt, contract: ctr }); } catch (e) { res = e; }
  check('buyer browser verifies the half-signed proposal', res && res.outputs, res && { check: res.check, msg: res.message });
  r = await call('POST', `/escrow/contracts/${cid}/proposals/release/sign`, { cookie: cat.cookie, body: { signed_psbt: V.signProposal(half.psbt, 'bitcoin', ck) } });
  check('buyer signature -> combined and broadcast', r.data?.status === 'broadcast', r);
  const sent = await (await fetch(MOCK + '/__sent')).json();
  const tx = bitcoin.Transaction.fromHex(sent[sent.length - 1]);
  const prevTxid = Buffer.from(tx.ins[0].hash).reverse().toString('hex');
  console.log('       broadcast tx:', { txidMatch: tx.getId() === r.data?.txid, prevMatch: prevTxid === t.getId(), witnessItems: tx.ins[0].witness.length, inputs: tx.ins.length });
  check('broadcast tx spends the funding output with a 2-of-3 witness', tx.getId() === r.data?.txid && prevTxid === t.getId() && tx.ins[0].witness.length === 4);
  const outs = tx.outs.map((o) => [bitcoin.address.fromOutputScript(o.script, NET), o.value]);
  check('on-chain outputs: buyer exact, fee exact, overfunding returned as change', outs.some(([a, v]) => a === ck.payoutAddress && v === 250000) && outs.some(([a, v]) => a === FEE_ADDR && v === 7500) && outs.some(([a]) => a === vk.payoutAddress), outs);

  console.log('WITHDRAWAL (server-built, browser-checked)');
  const addrs = D.deriveAllWalletAddresses(cat.phrase);
  r = await call('POST', '/wallet/addresses', { cookie: cat.cookie, body: { addresses: addrs } });
  check('frontend-derived wallet addresses accepted', r.status === 200, r);
  const btcAddr = addrs.find((a) => a.asset === 'BTC').address;
  r = await call('POST', '/wallet/addresses', { cookie: cat.cookie, body: { addresses: [{ asset: 'BTC', address: vk.payoutAddress }] } });
  check('deposit address cannot be swapped later', r.status === 409, r);
  const w = new bitcoin.Transaction(); w.version = 2; w.addInput(crypto.randomBytes(32), 0); w.addOutput(bitcoin.address.toOutputScript(btcAddr, NET), 80000);
  await mock({ utxos: { [btcAddr]: [{ txid: w.getId(), vout: 0, value: '80000', confirmations: 3 }] } });
  const dest = attacker.address.replace(/./g, (x) => x) && bitcoin.payments.p2wpkh({ pubkey: Buffer.from(root.derivePath('m/8').publicKey), network: NET }).address;
  const built = (await call('POST', '/wallet/build-tx', { cookie: cat.cookie, body: { asset: 'BTC', to: dest, amount: '20000', fee_rate: '5' } })).data;
  let wc = null; try { wc = W.verifyWithdrawal({ asset: 'BTC', format: built.format, data: built.data, to: dest, amount: 20000n, ownAddress: btcAddr }); } catch (e) { wc = e; }
  check('honest withdrawal passes the browser check', wc && wc.networkFee > 0n, wc && (wc.message || wc));
  throwsCheck('server-swapped recipient -> refused', () => W.verifyWithdrawal({ asset: 'BTC', format: built.format, data: cloneWithOut(built.data, 0, (o) => { o.script = attacker.output; }), to: dest, amount: 20000n, ownAddress: btcAddr }));
  throwsCheck('amount differs from what was typed -> refused', () => W.verifyWithdrawal({ asset: 'BTC', format: built.format, data: built.data, to: dest, amount: 20001n, ownAddress: btcAddr }));
  const signedOwn = await S.signTransaction('BTC', 'psbt_base64', built.data, cat.phrase);
  r = await call('POST', '/wallet/broadcast', { cookie: cat.cookie, body: { asset: 'BTC', signed_tx: signedOwn, to: dest, amount: '20000' } });
  check('own signed withdrawal broadcasts', r.status === 200 && !!r.data.txid, r);
  const vicAddrs = D.deriveAllWalletAddresses(vic.phrase);
  await call('POST', '/wallet/addresses', { cookie: vic.cookie, body: { addresses: vicAddrs } });
  const vBtc = vicAddrs.find((a) => a.asset === 'BTC').address;
  const w2 = new bitcoin.Transaction(); w2.version = 2; w2.addInput(crypto.randomBytes(32), 0); w2.addOutput(bitcoin.address.toOutputScript(vBtc, NET), 60000);
  await mock({ utxos: { [vBtc]: [{ txid: w2.getId(), vout: 0, value: '60000', confirmations: 3 }] } });
  const b2 = (await call('POST', '/wallet/build-tx', { cookie: vic.cookie, body: { asset: 'BTC', to: dest, amount: '10000', fee_rate: '5' } })).data;
  const foreign = await S.signTransaction('BTC', 'psbt_base64', b2.data, vic.phrase);
  r = await call('POST', '/wallet/broadcast', { cookie: cat.cookie, body: { asset: 'BTC', signed_tx: foreign, to: dest, amount: '10000' } });
  check("someone else's signed tx is not relayed", r.status === 400 && r.data.error === 'not_your_transaction', r);
  const TW = require(F + 'node_modules/tronweb');
  const tw = TW.default ?? TW;
  console.log('       tronweb txCheck available:', typeof (tw.utils?.transaction?.txCheck), '| tronweb version:', require(F + 'node_modules/tronweb/package.json').version);
  console.log(`\n${pass} passed, ${fail} failed`);
  await db.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
