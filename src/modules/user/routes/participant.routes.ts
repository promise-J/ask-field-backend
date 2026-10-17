import { Router } from 'express';
import { validate } from '../../../middlewares/validate';
import { authMiddleware, requireRole } from '../../../middlewares/auth.middleware';
import { authLimiter } from '../../../middlewares/rateLimiter.middleware';
import { participantController as c, completeProfile } from '../controllers/participant.controller';
import {
  resendVerificationSchema,
  completeProfileSchema,
  googleAuthSchema,
  loginSchema,
  registerParticipantSchema,
  resetPasswordSchema,
  sendOtpSchema,
  verifyOtpSchema,
} from '../user.validation';
import walletRoutes from '../../wallet/wallet.participant.routes';

const router = Router();
const participantOnly = [authMiddleware, requireRole('participant')];

router.post('/auth/register', authLimiter, validate(registerParticipantSchema), c.register);
router.post('/auth/login', authLimiter, validate(loginSchema), c.login);
router.get('/auth/verify-email', c.verifyEmail);
router.post('/auth/resend-verification', authLimiter, validate(resendVerificationSchema), c.resendVerification);
router.post('/auth/google-auth', authLimiter, validate(googleAuthSchema), c.googleAuth);
// Works for researchers too: the frontend uses this one path for every account type.
router.get('/auth/refresh-token', c.refreshToken);
router.post('/auth/send-otp', authLimiter, validate(sendOtpSchema), c.sendOtp);
router.post('/auth/verify-otp', authLimiter, validate(verifyOtpSchema), c.verifyOtp);
router.post('/auth/reset-password', authLimiter, validate(resetPasswordSchema), c.resetPassword);
router.post('/auth/complete-profile', ...participantOnly, validate(completeProfileSchema), completeProfile);

router.get('/me', ...participantOnly, c.me);
router.use('/', walletRoutes); // /earnings, /payout-details, /payouts (each checks the participant token)

export default router;
