import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { apiSuccessResponse } from '../../utils/apiResponse';
import * as verify from './verification.service';

/**
 * Participant Stage 1, canvas 1.7–1.9. Mounted at /api/participants/me/verification behind the
 * participant token (see participant.routes.ts).
 */
const router = Router();

const sendSchema = z.object({
  phone: z.string().trim().min(6, 'Enter your phone number.').max(24),
  channel: z.enum(['whatsapp', 'sms']).default('whatsapp'),
});
const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.') });
const selfieSchema = z.object({
  session: z.string().min(8).max(200),
  // Test provider only: which result to pretend the check returned.
  testOutcome: z.enum(['verified', 'retry', 'review', 'duplicate']).optional(),
});

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'ok', await verify.status(req.user!.id));
}));

router.post('/consent', asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Thanks.', await verify.consent(req.user!.id));
}));

router.post('/phone/send', validate(sendSchema), asyncHandler(async (req: Request, res: Response) => {
  const r = await verify.sendCode(req.user!.id, req.body.phone, req.body.channel);
  apiSuccessResponse(res, r.channel === 'whatsapp' ? 'We sent a code on WhatsApp.' : 'We sent a code by text message.', r);
}));

router.post('/phone/verify', validate(codeSchema), asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Number confirmed.', await verify.checkCode(req.user!.id, req.body.code));
}));

router.post('/selfie/start', asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'ok', await verify.startSelfie(req.user!.id));
}));

router.post('/selfie/complete', validate(selfieSchema), asyncHandler(async (req: Request, res: Response) => {
  const s = await verify.completeSelfie(req.user!.id, req.body.session, req.body.testOutcome);
  apiSuccessResponse(res, s.status === 'verified' ? 'You’re verified.' : 'Selfie checked.', s);
}));

export default router;
