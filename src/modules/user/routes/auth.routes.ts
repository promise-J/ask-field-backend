import { Router, Request, Response } from 'express';
import { validate } from '../../../middlewares/validate';
import { authLimiter } from '../../../middlewares/rateLimiter.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { apiSuccessResponse } from '../../../utils/apiResponse';
import { refreshAccessToken } from '../services/auth.service';
import * as account from '../services/account.service';
import { resendVerificationSchema, resetPasswordSchema, sendOtpSchema, unifiedGoogleSchema, unifiedLoginSchema, verifyOtpSchema } from '../user.validation';

/** One sign-in for researchers and participants: /api/auth/*. */
const router = Router();

const sessionMessage = (data: any) => (data?.needsChoice ? 'Choose which account to open.' : 'Signed in.');

router.post('/login', authLimiter, validate(unifiedLoginSchema), asyncHandler(async (req: Request, res: Response) => {
  const { email, password, accountType, intent } = req.body;
  const data = await account.login(email, password, accountType, intent);
  apiSuccessResponse(res, sessionMessage(data), data);
}));

router.post('/google', authLimiter, validate(unifiedGoogleSchema), asyncHandler(async (req: Request, res: Response) => {
  const data = await account.google(req.body.token, req.body);
  apiSuccessResponse(res, sessionMessage(data), data);
}));

router.post('/resend-verification', authLimiter, validate(resendVerificationSchema), asyncHandler(async (req: Request, res: Response) => {
  await account.resendVerification(req.body.email, req.body.accountType);
  apiSuccessResponse(res, "If that email needs confirming, we've sent a new link.", {});
}));

router.post('/send-otp', authLimiter, validate(sendOtpSchema), asyncHandler(async (req: Request, res: Response) => {
  await account.sendResetCode(req.body.email);
  apiSuccessResponse(res, "If an account exists for this email, we've sent a 6-digit code.", {});
}));

router.post('/verify-otp', authLimiter, validate(verifyOtpSchema), asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Code confirmed. Choose a new password.', await account.verifyResetCode(req.body.email, req.body.code));
}));

router.post('/reset-password', authLimiter, validate(resetPasswordSchema), asyncHandler(async (req: Request, res: Response) => {
  const intent = req.body.intent === 'participant' || req.body.intent === 'researcher' ? req.body.intent : undefined;
  const data = await account.resetPassword(req.body.email, req.body.token, req.body.password, intent);
  apiSuccessResponse(res, "Password updated. You're signed in.", data);
}));

router.get('/refresh-token', asyncHandler(async (req: Request, res: Response) => {
  const header = req.headers.token;
  apiSuccessResponse(res, 'Session refreshed.', await refreshAccessToken(Array.isArray(header) ? header[0] : header));
}));

export default router;
