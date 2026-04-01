import { Router } from "express";
import {
  completeProfile,
  createUser,
  getRefreshToken,
  getUser,
  googleAuth,
  loginUser,
  resetPassword,
  sendOtp,
  verifyEmail,
  verifyOtp,
} from "../controllers/participant.controller";
import { validate } from "../../../middlewares/validate";
import {
  completeProfileSchema,
  createParticipantSchema,
  googleAuthSchema,
  loginParticipantSchema,
  resetPasswordSchema,
  sendOtpSchema,
  verifyOtpSchema,
} from "../user.validation";
import { authMiddleware } from "../../../middlewares/auth/auth.middleware";
import {
  ROUTE_AUTH_GOOGLE_AUTH,
  ROUTE_AUTH_LOGIN,
  ROUTE_AUTH_REFRESH_TOKEN,
  ROUTE_AUTH_REGISTER,
  ROUTE_AUTH_SEND_OTP,
  ROUTE_AUTH_VERIFY_EMAIL,
  ROUTE_AUTH_VERIFY_OTP,
  ROUTE_COMPLETE_PROFILE,
  ROUTE_ME,
  ROUTE_RESET_PASSWORD,
} from "../../../utils/page-routes";

const router = Router();

router.post(ROUTE_AUTH_REGISTER, validate(createParticipantSchema), createUser);
router.post(ROUTE_AUTH_LOGIN, validate(loginParticipantSchema), loginUser);
router.get(ROUTE_AUTH_VERIFY_EMAIL, verifyEmail);
router.post(ROUTE_AUTH_GOOGLE_AUTH, validate(googleAuthSchema), googleAuth);
router.get(ROUTE_AUTH_REFRESH_TOKEN, getRefreshToken);
router.post(ROUTE_AUTH_SEND_OTP, validate(sendOtpSchema),sendOtp);
router.post(ROUTE_AUTH_VERIFY_OTP, validate(verifyOtpSchema), verifyOtp);
router.post(ROUTE_RESET_PASSWORD, validate(resetPasswordSchema), resetPassword);
router.get(ROUTE_ME, authMiddleware, getUser);
router.post(
  ROUTE_COMPLETE_PROFILE,
  validate(completeProfileSchema),
  authMiddleware,
  completeProfile
);

export default router;
