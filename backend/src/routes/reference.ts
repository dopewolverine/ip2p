import { Router } from 'express';
import { pool } from '../db/pool';

export const referenceRouter = Router();

// Public, read-only reference data - needed by the offer-creation form
// and the marketplace browse filters alike. Small tables, no pagination.

referenceRouter.get('/reference/assets', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT symbol, name, chain, slug, decimals FROM assets WHERE active = true ORDER BY symbol`
  );
  res.json({ assets: rows });
});

referenceRouter.get('/reference/countries', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT iso_code, name, slug FROM countries WHERE active = true ORDER BY name`
  );
  res.json({ countries: rows });
});

referenceRouter.get('/reference/currencies', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT code, name, symbol, decimal_places, slug FROM currencies WHERE active = true ORDER BY code`
  );
  res.json({ currencies: rows });
});

referenceRouter.get('/reference/payment-methods', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT name, slug, category, risk_tier FROM payment_methods WHERE active = true ORDER BY name`
  );
  res.json({ payment_methods: rows });
});
