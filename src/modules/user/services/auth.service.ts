import { Model } from 'mongoose';
import AppError from '../../../error-helpers/appError';
import { env, config } from '../../../config/env';
import { comparePassword, hashPassword, matchesHash, randomOtp, randomToken, sha256 } from '../../../utils/hash';
import { emails, sendMail } from '../../../utils/mailer';
import { issueTokens, UserType, verifyRefreshToken } from '../../../utils/jwt';
import { GoogleProfile, verifyFirebaseIdToken } from '../../../utils/firebase';

export const SECRETS =
  '+password +verificationToken +verificationTokenExpires +verificationSentAt +otp +otpExpires +otpAttempts +resetToken +resetTokenExpires';
const DAY = 24 * 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
/** Minimum gap between two verification emails to the same address. */
export const RESEND_GAP_SECONDS = 60;

const normal = (email: string) => String(email).toLowerCase().trim();

/**
 * Sign-up, email verification, login, Google sign-in and password reset for ONE account type.
 * Participants and researchers each get an instance; account.service.ts combines them for the
 * single sign-in page. Errors carry a `code` the frontend switches on (see Stage 1 on the canvas).
 */
export class AuthService {
  constructor(public model: Model<any>, public userType: UserType) {}

  private verifyPath() {
    return this.userType === 'researcher' ? '/auth/researcher/verify-email' : '/auth/verify-email';
  }

  findByEmail(email: string) {
    return this.model.findOne({ email: normal(email) }).select(SECRETS);
  }

  private async sendVerification(user: any) {
    const token = randomToken();
    user.verificationToken = sha256(token);
    user.verificationTokenExpires = new Date(Date.now() + DAY);
    user.verificationSentAt = new Date();
    await user.save();
    const link = `${env.FRONTEND_URL}${this.verifyPath()}?email=${encodeURIComponent(user.email)}&token=${token}`;
    await sendMail({ to: user.email, ...emails.verify(user.firstName, link) });
  }

  private session(user: any) {
    return { ...issueTokens({ id: String(user._id), userType: this.userType, sid: randomToken(8) }), user: user.toJSON(), userType: this.userType };
  }

  async register(data: Record<string, any>) {
    const email = normal(data.email);
    const existing = await this.model.findOne({ email });
    if (existing) {
      throw new AppError('An account with this email already exists. Sign in instead.', 409, 'email_taken');
    }
    const user = await this.model.create({
      ...data,
      email,
      signupPlatform: 'email',
      password: await hashPassword(data.password),
      isVerified: !env.REQUIRE_EMAIL_VERIFICATION,
    });
    if (env.REQUIRE_EMAIL_VERIFICATION) await this.sendVerification(user);
    return user.toJSON();
  }

  /** Sends a fresh verification link. Silent when there is nothing to send, so emails can't be probed. */
  async resendVerification(email: string) {
    const user = await this.findByEmail(email);
    if (!user || user.isVerified) return false;
    const last = user.verificationSentAt ? new Date(user.verificationSentAt).getTime() : 0;
    const wait = Math.ceil((last + RESEND_GAP_SECONDS * 1000 - Date.now()) / 1000);
    if (wait > 0) {
      throw new AppError(`Please wait ${wait} seconds before asking for another email.`, 429, 'too_soon', { retryAfter: wait });
    }
    await this.sendVerification(user);
    return true;
  }

  /**
   * Participant Stage 1 (canvas 1.3): fixes a mistyped email before it's confirmed, then sends the
   * link to the new address. The password proves this is the person who signed up.
   */
  async changeUnconfirmedEmail(email: string, password: string, newEmail: string) {
    const user = await this.findByEmail(email);
    if (!user || !(await this.passwordMatches(user, password))) {
      throw new AppError("That email and password don't match.", 401, 'wrong_credentials');
    }
    if (user.isVerified) throw new AppError('This email is already confirmed. Change it in Settings after you sign in.', 409, 'already_confirmed');
    const next = normal(newEmail);
    if (next === user.email) return user.toJSON();
    if (await this.model.exists({ email: next })) {
      throw new AppError('An account with this email already exists. Sign in instead.', 409, 'email_taken');
    }
    user.email = next;
    user.verificationSentAt = null; // the new address gets its link straight away
    await this.sendVerification(user);
    return user.toJSON();
  }

  /**
   * Confirms the email AND signs the person in (Stage 1, screen 1.4).
   * An already-used link does not sign anyone in: it only says the email is confirmed.
   */
  async verifyEmail(email: string, token: string) {
    const user = await this.findByEmail(email);
    if (!user) throw new AppError('This link is not valid.', 400, 'invalid_link');
    if (user.isVerified) return { alreadyVerified: true, user: user.toJSON() };
    if (!matchesHash(token, user.verificationToken)) {
      throw new AppError('This link is not valid. Ask for a new one below.', 400, 'invalid_link');
    }
    if (!user.verificationTokenExpires || user.verificationTokenExpires.getTime() < Date.now()) {
      throw new AppError('This link has expired. We can send you a new one.', 410, 'link_expired');
    }
    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = null;
    user.lastLoginAt = new Date();
    await user.save();
    return { alreadyVerified: false, ...this.session(user) };
  }

  /** True when the password matches this account (no side effects). */
  async passwordMatches(user: any, password: string) {
    return Boolean(user?.password) && (await comparePassword(password, user.password));
  }

  async login(email: string, password: string) {
    const user = await this.findByEmail(email);
    if (!user || !(await this.passwordMatches(user, password))) {
      if (user && !user.password && user.signupPlatform === 'google') {
        throw new AppError('This account uses Google. Choose "Continue with Google".', 400, 'use_google');
      }
      throw new AppError("That email and password don't match.", 401, 'wrong_credentials');
    }
    return this.startSession(user);
  }

  /** Signs in an account whose password was already checked. */
  async startSession(user: any) {
    if (!user.isVerified && env.REQUIRE_EMAIL_VERIFICATION) {
      const last = user.verificationSentAt ? new Date(user.verificationSentAt).getTime() : 0;
      if (Date.now() - last > RESEND_GAP_SECONDS * 1000) await this.sendVerification(user);
      throw new AppError("Confirm your email first. We've sent you a new link.", 403, 'email_not_confirmed', { email: user.email, accountType: this.userType });
    }
    user.lastLoginAt = new Date();
    await user.save();
    return this.session(user);
  }

  async googleAuth(idToken: string) {
    return this.googleAuthWithProfile(await verifyFirebaseIdToken(idToken));
  }

  /** Signs in with Google, creating the account when there is none. */
  async googleAuthWithProfile(g: GoogleProfile, extra: Record<string, unknown> = {}) {
    let user = await this.model.findOne({ email: g.email });
    if (!user) {
      user = await this.model.create({
        ...extra,
        email: g.email,
        firstName: g.firstName,
        lastName: g.lastName,
        googleId: g.googleId,
        signupPlatform: 'google',
        isVerified: true,
        image: g.imageUrl ? { imageUrl: g.imageUrl } : undefined,
      });
    } else {
      if (!user.googleId) user.googleId = g.googleId;
      if (!user.isVerified && g.emailVerified) user.isVerified = true;
    }
    user.lastLoginAt = new Date();
    await user.save();
    return this.session(user);
  }

  /** Stores a reset code (already hashed) on this account. Returns the account, or null when there is none. */
  async storeOtp(email: string, codeHash: string) {
    const user = await this.findByEmail(email);
    if (!user) return null;
    user.otp = codeHash;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    user.otpAttempts = 0;
    await user.save();
    return user;
  }

  async sendOtp(email: string) {
    const code = randomOtp();
    const user = await this.storeOtp(email, sha256(code));
    if (user) await sendMail({ to: user.email, ...emails.otp(user.firstName, code) });
  }

  /** Checks a reset code. On success stores `resetTokenValue` (or a new one) and returns it. */
  async verifyOtp(email: string, code: string, resetTokenValue?: string) {
    const user = await this.findByEmail(email);
    if (!user || !user.otp) throw new AppError('This code is not valid. Ask for a new one.', 400, 'invalid_code');
    if (user.otpAttempts >= MAX_OTP_ATTEMPTS) throw new AppError('Too many attempts. Ask for a new code.', 429, 'too_many_attempts');
    if (!user.otpExpires || user.otpExpires.getTime() < Date.now()) throw new AppError('This code has expired. Ask for a new one.', 400, 'code_expired');
    if (!matchesHash(code, user.otp)) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      await user.save();
      throw new AppError("That code isn't right. Check it and try again.", 400, 'wrong_code');
    }
    const token = resetTokenValue ?? randomToken();
    user.otp = undefined;
    user.otpExpires = null;
    user.otpAttempts = 0;
    user.resetToken = sha256(token);
    user.resetTokenExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();
    return { token };
  }

  /** Sets a new password. Returns the account so the caller can sign it in. */
  async resetPassword(email: string, token: string, password: string) {
    const user = await this.findByEmail(email);
    if (!user || !matchesHash(token, user.resetToken) || !user.resetTokenExpires || user.resetTokenExpires.getTime() < Date.now()) {
      throw new AppError('This reset has expired. Start again.', 400, 'reset_expired');
    }
    user.password = await hashPassword(password);
    user.resetToken = undefined;
    user.resetTokenExpires = null;
    if (user.signupPlatform === 'google') user.signupPlatform = 'email';
    user.isVerified = true; // they proved access to the inbox
    await user.save();
    return user;
  }

  /** Signs in an account straight after a password reset. */
  sessionAfterReset(user: any) {
    user.lastLoginAt = new Date();
    return user.save().then(() => this.session(user));
  }

  async me(id: string) {
    const user = await this.model.findById(id);
    if (!user) throw new AppError('Account not found.', 404, 'not_found');
    return user.toJSON();
  }
}

/** Issues a new access token from a refresh token. Works for both account types. */
export async function refreshAccessToken(refreshToken?: string) {
  if (!refreshToken) throw new AppError('Please sign in again.', 401, 'signed_out');
  let p: any;
  try {
    p = verifyRefreshToken(refreshToken.replace(/^Bearer\s+/i, ''));
  } catch {
    throw new AppError('Your session has expired. Please sign in again.', 401, 'signed_out');
  }
  // Alpha feedback: renewing only works within the idle limit. This also ends long-lived tokens issued before it.
  if (config.idleMinutes && (!p.iat || Date.now() / 1000 - p.iat > config.idleMinutes * 60)) {
    throw new AppError('You were signed out after a while without activity. Please sign in again.', 401, 'signed_out_idle');
  }
  // Stage 9: changing the password (or closing the account) signs out every other session.
  if (p.userType === 'researcher') {
    const { ResearcherModel } = await import('../models/researcher.model');
    const r: any = await ResearcherModel.findById(p.id).select('passwordChangedAt closedAt');
    if (!r || r.closedAt || (r.passwordChangedAt && (p.iat || 0) * 1000 < new Date(r.passwordChangedAt).getTime() - 1000)) {
      throw new AppError('Please sign in again.', 401, 'signed_out');
    }
  }
  // Participant Stage 7: closing, a password change, or "Sign out everywhere else".
  if (p.userType === 'participant') {
    const { sessionStillValid } = await import('../../account/settings.service');
    if (!(await sessionStillValid(p.id, p.iat, p.sid, p.at))) throw new AppError('Please sign in again.', 401, 'signed_out');
  }
  return issueTokens({ id: p.id, userType: p.userType, sid: p.sid });
}
