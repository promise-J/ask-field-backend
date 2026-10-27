import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { apiSuccessResponse } from '../../../utils/apiResponse';
import { AuthService, refreshAccessToken } from '../services/auth.service';
import { env } from '../../../config/env';

/** Builds the auth handlers for one account type. Response shapes match ask-field-frontend's userSlice. */
export function makeAuthController(service: AuthService) {
  return {
    resendVerification: asyncHandler(async (req: Request, res: Response) => {
      await service.resendVerification(req.body.email);
      apiSuccessResponse(res, "If that email needs confirming, we've sent a new link.", {});
    }),

    register: asyncHandler(async (req: Request, res: Response) => {
      const user = await service.register(req.body);
      const message = env.REQUIRE_EMAIL_VERIFICATION
        ? 'Account created. Check your email to verify your account.'
        : 'Account created. You can log in now.';
      apiSuccessResponse(res, message, user, 201);
    }),

    verifyEmail: asyncHandler(async (req: Request, res: Response) => {
      const { email, token } = req.query as Record<string, string>;
      if (!email || !token) {
        return res.status(400).json({ success: false, code: 'invalid_link', error: 'This link is not valid.', message: 'This link is not valid.' });
      }
      const result = await service.verifyEmail(String(email), String(token));
      // data carries the session (accessToken, refreshToken, user) unless the link was already used.
      apiSuccessResponse(res, result.alreadyVerified ? 'Your email is already confirmed. Sign in to continue.' : "Email confirmed. You're signed in.", result);
    }),

    login: asyncHandler(async (req: Request, res: Response) => {
      const data = await service.login(req.body.email, req.body.password);
      apiSuccessResponse(res, 'Logged in.', data);
    }),

    googleAuth: asyncHandler(async (req: Request, res: Response) => {
      const data = await service.googleAuth(req.body.token);
      apiSuccessResponse(res, 'Signed in with Google.', data);
    }),

    refreshToken: asyncHandler(async (req: Request, res: Response) => {
      const header = req.headers.token;
      const tokens = await refreshAccessToken(Array.isArray(header) ? header[0] : header);
      apiSuccessResponse(res, 'Session refreshed.', tokens);
    }),

    sendOtp: asyncHandler(async (req: Request, res: Response) => {
      await service.sendOtp(req.body.email);
      apiSuccessResponse(res, "If an account exists for this email, we've sent a 6-digit code to it.", {});
    }),

    verifyOtp: asyncHandler(async (req: Request, res: Response) => {
      const data = await service.verifyOtp(req.body.email, req.body.code);
      apiSuccessResponse(res, 'Code confirmed. Choose a new password.', data);
    }),

    resetPassword: asyncHandler(async (req: Request, res: Response) => {
      await service.resetPassword(req.body.email, req.body.token, req.body.password);
      apiSuccessResponse(res, 'Password updated. You can log in now.', 'ok');
    }),

    me: asyncHandler(async (req: Request, res: Response) => {
      apiSuccessResponse(res, 'Account fetched.', await service.me(req.user!.selfId || req.user!.id)); // the person signed in, whichever workspace (Stage 9)
    }),
  };
}
