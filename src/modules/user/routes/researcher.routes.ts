import { Router } from 'express';
import { validate } from '../../../middlewares/validate';
import { authMiddleware, requireRole } from '../../../middlewares/auth.middleware';
import { authLimiter } from '../../../middlewares/rateLimiter.middleware';
import { researcherController as c, completeResearcherProfile } from '../controllers/researcher.controller';
import {
  resendVerificationSchema,
  completeResearcherProfileSchema,
  googleAuthSchema,
  loginSchema,
  registerResearcherSchema,
  resetPasswordSchema,
  sendOtpSchema,
  verifyOtpSchema,
} from '../user.validation';
import { dashboardStats } from '../../survey/survey.controller';
import { asyncHandler } from '../../../utils/asyncHandler';
import { apiSuccessResponse } from '../../../utils/apiResponse';
import * as setup from '../services/setup.service';
import { profileSchema, staffLinkSchema, workEmailCodeSchema, workEmailSchema } from '../user.validation';
import { researcherWallet } from '../../wallet/wallet.controller';
import { foundingLab, homeSummary } from '../services/home.service';
import { foundingLabSchema } from '../user.validation';

const router = Router();
const researcherOnly = [authMiddleware, requireRole('researcher')];

router.post('/auth/register', authLimiter, validate(registerResearcherSchema), c.register);
router.post('/auth/login', authLimiter, validate(loginSchema), c.login);
router.get('/auth/verify-email', c.verifyEmail);
router.post('/auth/resend-verification', authLimiter, validate(resendVerificationSchema), c.resendVerification);
router.post('/auth/google-auth', authLimiter, validate(googleAuthSchema), c.googleAuth);
router.get('/auth/refresh-token', c.refreshToken);
router.post('/auth/send-otp', authLimiter, validate(sendOtpSchema), c.sendOtp);
router.post('/auth/verify-otp', authLimiter, validate(verifyOtpSchema), c.verifyOtp);
router.post('/auth/reset-password', authLimiter, validate(resetPasswordSchema), c.resetPassword);

router.post('/auth/complete-profile', ...researcherOnly, validate(completeResearcherProfileSchema), completeResearcherProfile);
router.get('/me', ...researcherOnly, c.me);

// Stage 2: account setup (2.1) and institution verification (2.2)
router.put('/me/profile', ...researcherOnly, validate(profileSchema), asyncHandler(async (req: any, res: any) => {
  const data = await setup.saveProfile(req.user.id, req.body);
  apiSuccessResponse(res, 'Saved.', data);
}));
router.post('/me/verification/email', ...researcherOnly, authLimiter, validate(workEmailSchema), asyncHandler(async (req: any, res: any) => {
  const data = await setup.startWorkEmail(req.user.id, req.body.email);
  apiSuccessResponse(res, data.alreadyVerified ? "You're already verified." : `We've sent a 6-digit code to ${req.body.email}.`, data);
}));
router.post('/me/verification/email/confirm', ...researcherOnly, authLimiter, validate(workEmailCodeSchema), asyncHandler(async (req: any, res: any) => {
  const data = await setup.confirmWorkEmail(req.user.id, req.body.code);
  apiSuccessResponse(res, data.status === 'verified' ? "You're verified." : "Email confirmed. We'll check your organisation within 2 working days.", data);
}));
router.post('/me/verification/link', ...researcherOnly, validate(staffLinkSchema), asyncHandler(async (req: any, res: any) => {
  const data = await setup.submitStaffLink(req.user.id, req.body.url);
  apiSuccessResponse(res, "Sent for review. We'll email you within 2 working days.", data);
}));
// Stage 3: the researcher home and the founding-lab card
router.get('/me/home', ...researcherOnly, asyncHandler(async (req: any, res: any) => {
  apiSuccessResponse(res, 'ok', await homeSummary(req.user.id));
}));
router.post('/me/founding-lab', ...researcherOnly, validate(foundingLabSchema), asyncHandler(async (req: any, res: any) => {
  const data = await foundingLab(req.user.id, req.body.action);
  apiSuccessResponse(res, data.status === 'applied' ? "Thanks for applying. We'll reply by email within 2 working days." : 'Hidden.', data);
}));
router.get('/dashboard-stats', ...researcherOnly, dashboardStats);
router.get('/wallet', ...researcherOnly, researcherWallet);

export default router;
