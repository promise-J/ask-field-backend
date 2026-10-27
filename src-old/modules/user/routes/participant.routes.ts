import { Router, Request, Response } from 'express';
import { validate } from '../../../middlewares/validate';
import { authMiddleware, requireRole } from '../../../middlewares/auth.middleware';
import { authLimiter } from '../../../middlewares/rateLimiter.middleware';
import { participantController as c, completeProfile, participantAuth as participantAuthService } from '../controllers/participant.controller';
import {
  resendVerificationSchema,
  completeProfileSchema,
  loginSchema,
  registerParticipantSchema,
  resetPasswordSchema,
  sendOtpSchema,
  verifyOtpSchema,
} from '../user.validation';
import walletRoutes from '../../wallet/wallet.participant.routes';
import verificationRoutes from '../../verification/verification.routes';
import { participantSignupGuards } from '../../../utils/signupGuards';
import { changeUnconfirmedEmailSchema, participantWaitlistSchema, unifiedGoogleSchema } from '../user.validation';
import * as account from '../services/account.service';
import { asyncHandler } from '../../../utils/asyncHandler';
import { apiSuccessResponse } from '../../../utils/apiResponse';
import { LeadModel } from '../../leads/lead.model';
import * as profile from '../services/profile.service';
import AppError from '../../../error-helpers/appError';
import { z } from 'zod';
import studiesRoutes from '../../studies/studies.routes';
import { stopAlertsByLink } from '../../studies/studies.service';
import accountRoutes, { publicAccountRoutes } from '../../account/account.routes';

const router = Router();
const participantOnly = [authMiddleware, requireRole('participant')];

router.post('/auth/register', authLimiter, participantSignupGuards, validate(registerParticipantSchema), c.register);
// Canvas 1.3: fix a mistyped email before confirming it.
router.post('/auth/change-email', authLimiter, validate(changeUnconfirmedEmailSchema), asyncHandler(async (req: Request, res: Response) => {
  const user = await participantAuthService.changeUnconfirmedEmail(req.body.email, req.body.password, req.body.newEmail);
  apiSuccessResponse(res, `We sent a new link to ${user.email}.`, { email: user.email });
}));
// Canvas 1.1: outside the participant countries, join the waitlist for your country.
router.post('/waitlist', authLimiter, validate(participantWaitlistSchema), asyncHandler(async (req: Request, res: Response) => {
  await LeadModel.updateOne(
    { type: 'participant-waitlist', email: req.body.email.toLowerCase() },
    { $set: { country: req.body.country, source: 'participant-join' }, $setOnInsert: { status: 'waiting' } },
    { upsert: true }
  );
  apiSuccessResponse(res, "You're on the list. We'll email you when we can pay people in your country.", {}, 201);
}));
router.post('/auth/login', authLimiter, validate(loginSchema), c.login);
router.get('/auth/verify-email', c.verifyEmail);
router.post('/auth/resend-verification', authLimiter, validate(resendVerificationSchema), c.resendVerification);
// Older clients call this path; a NEW participant account still needs the country and agreement (canvas 1.2).
router.post('/auth/google-auth', authLimiter, validate(unifiedGoogleSchema), asyncHandler(async (req: Request, res: Response) => {
  const data = await account.google(req.body.token, { accountType: 'participant', intent: 'participant', country: req.body.country, agree: req.body.agree });
  apiSuccessResponse(res, 'Signed in with Google.', data);
}));
// Works for researchers too: the frontend uses this one path for every account type.
router.get('/auth/refresh-token', c.refreshToken);
router.post('/auth/send-otp', authLimiter, validate(sendOtpSchema), c.sendOtp);
router.post('/auth/verify-otp', authLimiter, validate(verifyOtpSchema), c.verifyOtp);
router.post('/auth/reset-password', authLimiter, validate(resetPasswordSchema), c.resetPassword);
router.post('/auth/complete-profile', ...participantOnly, validate(completeProfileSchema), completeProfile);

router.get('/me', ...participantOnly, c.me);
router.use('/me/verification', ...participantOnly, verificationRoutes);

// Participant Stage 2: the "About you" profile and the optional LinkedIn link (canvas 2.1–2.5).
router.get('/me/profile', ...participantOnly, asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'ok', await profile.getProfile(req.user!.id));
}));
router.put('/me/profile/:part', ...participantOnly, asyncHandler(async (req: Request, res: Response) => {
  const part = req.params.part as profile.Part;
  if (!profile.PARTS.includes(part)) throw new AppError('Not found.', 404);
  apiSuccessResponse(res, 'Saved.', await profile.savePart(req.user!.id, part, req.body || {}));
}));
router.post('/me/linkedin/start', ...participantOnly, asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'ok', await profile.linkedinStart(req.user!.id));
}));
router.post('/me/linkedin/complete', ...participantOnly, validate(z.object({ code: z.string().min(1).max(2000), state: z.string().min(8).max(200) })), asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'LinkedIn connected.', await profile.linkedinComplete(req.user!.id, req.body.code, req.body.state));
}));
router.delete('/me/linkedin', ...participantOnly, asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'LinkedIn disconnected.', await profile.linkedinDisconnect(req.user!.id));
}));
// Participant Stage 7: settings, your data, help and reporting a study (canvas 7.1–7.4).
router.use('/me', ...participantOnly, accountRoutes);
router.use('/settings', publicAccountRoutes);
// Participant Stage 3: home, studies that fit, a page per study, "Not interested", and study emails (canvas 3.1–3.4).
router.use('/me', ...participantOnly, studiesRoutes);
// The "Stop these emails" link in a study email. No sign-in needed; the link carries a signed token.
router.post('/alerts/stop', authLimiter, validate(z.object({ u: z.string().min(1).max(64), t: z.string().min(1).max(64) })), asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Study emails are off.', await stopAlertsByLink(req.body.u, req.body.t));
}));
router.use('/', walletRoutes); // /earnings, /payout-details, /payouts (each checks the participant token)

export default router;
