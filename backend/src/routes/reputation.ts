import { Router } from 'express';
import { getSerializedReputation } from '../reputation/serializer';

export const reputationRouter = Router();

// ---- GET /users/:id/reputation ----
// Spec §3 - the profile view. Routes through the one serializer, same
// as every other reputation-showing endpoint.
reputationRouter.get('/users/:id/reputation', async (req, res) => {
  const reputation = await getSerializedReputation(req.params.id);
  res.json(reputation);
});
