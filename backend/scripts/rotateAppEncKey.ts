// Re-encrypts every stored 2FA secret from OLD_APP_ENC_KEY to NEW_APP_ENC_KEY.
// APP_ENC_KEY protects nothing else - wallet blobs are encrypted in users'
// browsers with their own passwords, and sessions don't use it.
//
//   OLD_APP_ENC_KEY=<hex> NEW_APP_ENC_KEY=<hex> npm run rotate-app-enc-key -- --dry-run
//   OLD_APP_ENC_KEY=<hex> NEW_APP_ENC_KEY=<hex> npm run rotate-app-enc-key
//
// Then set APP_ENC_KEY=<new> and restart the backend.
import 'dotenv/config';
import { Client } from 'pg';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function key(name: string): Buffer {
  const v = process.env[name];
  const buf = Buffer.from(v ?? '', 'hex');
  if (!v || buf.length !== 32) throw new Error(`${name} must be 32 bytes, hex-encoded`);
  return buf;
}

function decrypt(enc: Buffer, k: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', k, enc.subarray(0, 12));
  decipher.setAuthTag(enc.subarray(12, 28));
  return Buffer.concat([decipher.update(enc.subarray(28)), decipher.final()]).toString('utf8');
}

function encrypt(secret: string, k: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

async function main() {
  const oldKey = key('OLD_APP_ENC_KEY');
  const newKey = key('NEW_APP_ENC_KEY');
  const dryRun = process.argv.includes('--dry-run');
  const client = new Client({ connectionString: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id, totp_secret_enc FROM users WHERE totp_secret_enc IS NOT NULL FOR UPDATE');
    for (const r of rows) {
      const secret = decrypt(Buffer.from(r.totp_secret_enc), oldKey);
      await client.query('UPDATE users SET totp_secret_enc = $1 WHERE id = $2', [encrypt(secret, newKey), r.id]);
    }
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    console.log(`${dryRun ? '[dry run] would re-encrypt' : 'Re-encrypted'} ${rows.length} 2FA secret(s).`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
