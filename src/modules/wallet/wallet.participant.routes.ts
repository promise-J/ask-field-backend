import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../../middlewares/validate';
import { authMiddleware, requireRole } from '../../middlewares/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { apiSuccessResponse } from '../../utils/apiResponse';
import { participantEarnings } from './wallet.controller';
import * as payouts from '../payouts/payouts.service';

// Mounted under /participants.
const router = Router();
const participantOnly = [authMiddleware, requireRole('participant')];
const ok = (fn: (req: Request) => Promise<unknown>, message = 'ok', code = 200) =>
  asyncHandler(async (req: Request, res: Response) => apiSuccessResponse(res, message, await fn(req), code));

router.get('/earnings', ...participantOnly, participantEarnings);

// Participant Stage 6: get paid (canvas 6.1–6.4). The old /payout-details and /payouts endpoints are replaced.
router.get('/me/money', ...participantOnly, ok((r) => payouts.moneyView(r.user!.id)));
router.get('/me/payout-method', ...participantOnly, ok((r) => payouts.payoutMethod(r.user!.id)));
router.put(
  '/me/payout-method',
  ...participantOnly,
  validate(z.object({ method: z.enum(['bank', 'mobile-money', 'airtime', 'paypal']), institution: z.string().trim().max(80).optional(), account: z.string().trim().min(3, 'Enter the account.').max(120) })),
  ok((r) => payouts.savePayoutMethod(r.user!.id, r.body), 'Saved. Cash-outs go here now.')
);
router.post('/me/payouts/quote', ...participantOnly, validate(z.object({ amount: z.coerce.number().positive().max(100000).optional() })), ok((r) => payouts.quote(r.user!.id, r.body)));
router.post('/me/payouts', ...participantOnly, validate(z.object({ quoteId: z.string().min(1, 'Get a new amount first.') })), ok((r) => payouts.cashOut(r.user!.id, r.body.quoteId), 'On its way.', 201));
router.get('/me/payouts/:id', ...participantOnly, ok((r) => payouts.statusView(r.user!.id, r.params.id)));
router.get('/me/statement.csv', ...participantOnly, asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="joinstudy-statement.csv"');
  res.send(await payouts.statementCsv(req.user!.id));
}));

export default router;
