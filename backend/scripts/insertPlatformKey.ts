// Records the Owner's Ledger xpub as the active platform key for a chain
// (P2 §3, §4.1 step 4). Public key material only - the script refuses a
// private extended key. Needs MIGRATE_DATABASE_URL: the app role cannot
// UPDATE platform_keys, by design.
//
//   npm run insert-platform-key -- bitcoin <xpub> "m/45'/0'"
//
// Compare the printed index-0 key with the Ledger before relying on it,
// and pin the same xpub in the frontend build (NEXT_PUBLIC_PLATFORM_XPUB_*).
import 'dotenv/config';
import { Client } from 'pg';
import { parseNeuteredXpub } from '../src/escrow/multisig';

async function main() {
  const [chain, xpub, base] = process.argv.slice(2);
  if ((chain !== 'bitcoin' && chain !== 'litecoin') || !xpub || !base || !/^m(\/\d+')+$/.test(base)) {
    throw new Error(`usage: insertPlatformKey <bitcoin|litecoin> <xpub> "m/45'/0'"`);
  }
  const node = parseNeuteredXpub(xpub, chain);
  console.log(`child 0 public key: ${Buffer.from(node.derive(0).publicKey).toString('hex')}`);

  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) throw new Error('MIGRATE_DATABASE_URL is required');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE platform_keys SET active = false WHERE chain = $1 AND active = true', [chain]);
    await client.query('INSERT INTO platform_keys (chain, xpub, derivation_base, active) VALUES ($1, $2, $3, true)', [chain, xpub, base]);
    await client.query('COMMIT');
    console.log(`active ${chain} platform key recorded.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
