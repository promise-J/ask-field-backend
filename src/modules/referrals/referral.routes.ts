import { Router, Request, Response } from 'express';
import { authMiddleware, requireRole } from '../../middlewares/auth.middleware';
import { authLimiter } from '../../middlewares/rateLimiter.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { apiSuccessResponse } from '../../utils/apiResponse';
import * as referrals from './referral.service';

/**
 * Refer a friend.
 *   GET  /api/referrals/code/:code                  public: who invited you (the sign-up banner)
 *   GET  /api/researchers/me/referrals              your link, friends, credit (researcher)
 *   POST /api/researchers/me/referrals/hide-card    "Not now" on the dashboard card
 *   GET  /api/participants/me/referrals             your link, friends, badge, place in the queue (participant)
 */
export const publicReferralRoutes = Router();
publicReferralRoutes.get('/code/:code', authLimiter, asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'ok', await referrals.lookupCode(req.params.code));
}));

export const researcherReferralRoutes = Router();
researcherReferralRoutes.use(authMiddleware, requireRole('researcher'));
// Stage 9 workspaces: referrals belong to the person signed in, not the workspace they're working in.
researcherReferralRoutes.get('/', asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'ok', await referrals.researcherReferrals(req.user!.selfId || req.user!.id));
}));
researcherReferralRoutes.post('/hide-card', asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Hidden.', await referrals.hideResearcherCard(req.user!.selfId || req.user!.id));
}));

export const participantReferralRoutes = Router();
participantReferralRoutes.use(authMiddleware, requireRole('participant'));
participantReferralRoutes.get('/', asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'ok', await referrals.participantReferrals(req.user!.id));
}));
