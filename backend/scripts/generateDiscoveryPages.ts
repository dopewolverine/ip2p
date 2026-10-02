/**
 * P3 §6.2 - the discovery static-page generator. A standalone script,
 * run nightly by cron, deliberately NOT an Express route - it writes
 * files for nginx to serve directly, with try_files falling back to the
 * SPA for anything it didn't generate. No SSR framework, no change to
 * the app itself.
 *
 * Usage:
 *   ts-node scripts/generateDiscoveryPages.ts
 * Cron (nightly, per spec §6.2 step 5 - offers sit up for days, per-
 * request freshness isn't needed):
 *   0 3 * * * cd /path/to/backend && npx ts-node scripts/generateDiscoveryPages.ts >> /var/log/ip2p/discovery.log 2>&1
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync, rmSync, renameSync, existsSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

const OUTPUT_ROOT = process.env.DISCOVERY_OUTPUT_ROOT ?? '/var/www/pages';
const SITE_URL = process.env.SITE_URL ?? 'https://example.com';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface PageCombo {
  side: 'buy' | 'sell';
  assetSlug: string;
  assetSymbol: string;
  countrySlug: string | null; // null = the two-level page (no country)
  countryName: string | null;
  offerCount: number;
}

// Spec §6.2 step 1 - count active offers per side × asset × (country or
// null). Skip anything with zero (§6.2: "never generate a page with
// zero offers - thin content drags the whole domain's ranking down").
async function queryCombos(): Promise<PageCombo[]> {
  const { rows: withCountry } = await pool.query(`
    SELECT o.side, a.slug AS asset_slug, a.symbol AS asset_symbol,
           c.slug AS country_slug, c.name AS country_name, COUNT(*) AS offer_count
    FROM offers o
    JOIN assets a ON a.id = o.asset_id
    JOIN countries c ON c.id = o.country_id
    WHERE o.status = 'active'
    GROUP BY o.side, a.slug, a.symbol, c.slug, c.name
    HAVING COUNT(*) > 0
  `);

  const { rows: withoutCountry } = await pool.query(`
    SELECT o.side, a.slug AS asset_slug, a.symbol AS asset_symbol, COUNT(*) AS offer_count
    FROM offers o
    JOIN assets a ON a.id = o.asset_id
    WHERE o.status = 'active'
    GROUP BY o.side, a.slug, a.symbol
    HAVING COUNT(*) > 0
  `);

  return [
    ...withoutCountry.map((r) => ({
      side: r.side, assetSlug: r.asset_slug, assetSymbol: r.asset_symbol,
      countrySlug: null, countryName: null, offerCount: Number(r.offer_count),
    })),
    ...withCountry.map((r) => ({
      side: r.side, assetSlug: r.asset_slug, assetSymbol: r.asset_symbol,
      countrySlug: r.country_slug, countryName: r.country_name, offerCount: Number(r.offer_count),
    })),
  ];
}

async function fetchOffersForCombo(combo: PageCombo) {
  const params: unknown[] = [combo.side, combo.assetSlug];
  let countryClause = '';
  if (combo.countrySlug) {
    countryClause = 'AND c.slug = $3';
    params.push(combo.countrySlug);
  }
  const { rows } = await pool.query(
    `SELECT o.id, o.price_type, o.price, o.margin_percent, o.min_amount, o.max_amount,
            cur.code AS currency_code, pm.name AS payment_method_name, c.name AS country_name
     FROM offers o
     JOIN assets a ON a.id = o.asset_id
     JOIN countries c ON c.id = o.country_id
     JOIN currencies cur ON cur.id = o.fiat_currency_id
     JOIN payment_methods pm ON pm.id = o.payment_method_id
     WHERE o.status = 'active' AND o.side = $1 AND a.slug = $2 ${countryClause}
     ORDER BY o.created_at DESC`,
    params
  );
  return rows;
}

// Spec §6.2 step 2 - unique title, meta description, H1 per page, built
// from the dimensions. "Real offers rendered as content; the offers ARE
// the content" - not a template with a generic sentence and a widget.
function renderPage(combo: PageCombo, offers: any[]): string {
  const verb = combo.side === 'sell' ? 'Buy' : 'Sell';
  const place = combo.countryName ? ` in ${combo.countryName}` : '';
  const title = `${verb} ${combo.assetSymbol}${place} — ${combo.offerCount} offers | iP2P`;
  const description = `${combo.offerCount} active offers to ${verb.toLowerCase()} ${combo.assetSymbol}${place} on iP2P, peer to peer.`;
  const h1 = `${verb} ${combo.assetSymbol}${place}`;

  const rows = offers.map((o) => {
    const price = o.price_type === 'fixed' ? o.price : `market + ${o.margin_percent}%`;
    return `<tr><td>${o.payment_method_name}</td><td>${price} ${o.currency_code}</td><td>${o.min_amount}–${o.max_amount} ${o.currency_code}</td></tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${SITE_URL}/${combo.side === 'sell' ? 'sell' : 'buy'}/${combo.assetSlug}${combo.countrySlug ? '/' + combo.countrySlug : ''}">
</head>
<body>
<h1>${escapeHtml(h1)}</h1>
<table>
<thead><tr><th>Payment method</th><th>Price</th><th>Limits</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

async function main() {
  console.log(`[${new Date().toISOString()}] Starting discovery page generation`);

  const combos = await queryCombos();
  console.log(`Found ${combos.length} combos with active offers`);

  // Spec §6.2 step 3 - write to a temp directory and swap at the end,
  // so a failed run never leaves the site half-empty.
  const tempDir = join(OUTPUT_ROOT, `.tmp-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  const sitemapUrls: string[] = [];

  for (const combo of combos) {
    const offers = await fetchOffersForCombo(combo);
    if (offers.length === 0) continue; // re-check — offers could have changed mid-run

    const sideSegment = combo.side === 'sell' ? 'sell' : 'buy';
    const relPath = combo.countrySlug
      ? `${sideSegment}/${combo.assetSlug}/${combo.countrySlug}`
      : `${sideSegment}/${combo.assetSlug}`;
    const dir = join(tempDir, relPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), renderPage(combo, offers), 'utf8');
    sitemapUrls.push(`${SITE_URL}/${relPath}`);
  }

  // Spec §6.2 step 6 - one sitemap file, same script.
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls
    .map((u) => `  <url><loc>${escapeHtml(u)}</loc></url>`)
    .join('\n')}\n</urlset>`;
  writeFileSync(join(tempDir, 'sitemap.xml'), sitemap, 'utf8');

  // The swap. Old directory (if any) removed only after the new one is
  // fully in place - a crash before this line leaves the live site
  // completely untouched (spec §6.2 acceptance criterion 18).
  const liveDir = join(OUTPUT_ROOT, 'current');
  const previousDir = join(OUTPUT_ROOT, `.previous-${Date.now()}`);
  if (existsSync(liveDir)) renameSync(liveDir, previousDir);
  renameSync(tempDir, liveDir);
  if (existsSync(previousDir)) rmSync(previousDir, { recursive: true, force: true });

  console.log(`[${new Date().toISOString()}] Wrote ${sitemapUrls.length} pages + sitemap to ${liveDir}`);
  await pool.end();
}

main().catch((err) => {
  console.error('Discovery page generation failed:', err);
  process.exit(1);
});
