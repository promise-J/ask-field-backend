import { Router, Request, Response } from 'express';
import AppError from '../../error-helpers/appError';
import { env } from '../../config/env';
import { asyncHandler } from '../../utils/asyncHandler';
import { apiSuccessResponse } from '../../utils/apiResponse';
import { authMiddleware, requireRole } from '../../middlewares/auth.middleware';
import { FundingModel } from './funding.model';
import { verifyStripeSignature } from './provider';
import { fundingDocument, markPaid } from './launch.service';

/** Stripe calls this when a card payment succeeds. Mounted with a raw body (see app.ts). */
export const stripeWebhook = asyncHandler(async (req: Request, res: Response) => {
  if (!env.STRIPE_WEBHOOK_SECRET || !verifyStripeSignature(req.body as Buffer, req.header('stripe-signature'), env.STRIPE_WEBHOOK_SECRET)) {
    throw new AppError('Bad signature.', 400);
  }
  const event = JSON.parse((req.body as Buffer).toString('utf8'));
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const f = await FundingModel.findOne({ providerRef: pi.id });
    if (f) await markPaid(String(f._id), { cardLast4: pi.payment_method_details?.card?.last4 });
  }
  res.json({ received: true });
});

const router = Router();
const researcher = [authMiddleware, requireRole('researcher')];

/** Test provider only (no Stripe key, not production): stands in for the card form and webhook. */
router.post('/test-confirm/:fundingId', ...researcher, asyncHandler(async (req: Request, res: Response) => {
  if (env.STRIPE_SECRET_KEY || env.NODE_ENV === 'production') throw new AppError('Not found.', 404);
  const f: any = await FundingModel.findOne({ _id: req.params.fundingId, researcherId: req.user!.id, provider: 'test' });
  if (!f) throw new AppError('Payment not found.', 404);
  await markPaid(String(f._id), { cardLast4: '4242' });
  apiSuccessResponse(res, 'Paid.', { status: 'paid' });
}));

/** Receipt or invoice, printable. */
router.get('/fundings/:fundingId/document', ...researcher, asyncHandler(async (req: Request, res: Response) => {
  res.type('html').send(await fundingDocument(req.user!.id, req.params.fundingId));
}));

export default router;
