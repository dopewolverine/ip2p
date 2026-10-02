import { Router } from 'express';
import { RECOMMENDED_KDF_PARAMS } from '../lib/kdfParams';

export const kdfParamsRouter = Router();

// Public (spec §7.4) - registration needs this before deriving.
kdfParamsRouter.get('/kdf-params', (_req, res) => {
  res.json(RECOMMENDED_KDF_PARAMS);
});
