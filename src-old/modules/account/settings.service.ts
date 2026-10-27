import crypto from 'crypto';
import AppError from '../../error-helpers/appError';
import { config, env } from '../../config/env';
import { sendMail } from '../../utils/mailer';
import { comparePassword, hashPassword, randomToken, sha256 } from '../../utils/hash';
import { issueTokens } from '../../utils/jwt';
import { ParticipantModel } from '../user/models/participant.model';
import { ClosedIdentityModel } from './models';

/** Participant Stage 7, canvas 7.1: Settings (email, password, WhatsApp number, emails, sign out everywhere else). */

const site = (path: string) => `${env.FRONTEND_URL.replace(/\/$/, '')}${path}`;
const HELLO = 'hello@joinstudy.io';

export async function load(id: string, extra = '') {
  const p: any = await ParticipantModel.findById(id).select(extra);
  if (!p || p.closedAt) throw new AppError('Account not found.', 404);
  return p;
}

async function checkPassword(p: any, password?: string) {
  if (p.password && !(password && (await comparePassword(password, p.password)))) throw new AppError('Your password isn’t right.', 400, 'wrong_password');
}

/** A one-way code for a closed account's phone, face check or payout account (see ClosedIdentity). */
export const identityHash = (kind: string, value: string) => crypto.createHmac('sha256', config.phoneHashSecret).update(`closed|${kind}|${value}`).digest('hex');

/** True when this phone (or payout account) belonged to an account closed in the last 12 months. */
export async function closedRecently(kind: 'phone' | 'payout' | 'selfie', rawHash: string) {
  return Boolean(await ClosedIdentityModel.exists({ kind, hash: identityHash(kind, rawHash), expiresAt: { $gt: new Date() } }));
}

export async function settings(id: string) {
  const p = await load(id, '+password');
  const v = p.verification || {};
  const verified = v.status === 'verified';
  return {
    email: p.email,
    pendingEmail: p.pendingEmail || null,
    hasPassword: Boolean(p.password),
    passwordChangedAt: p.passwordChangedAt || null,
    signupPlatform: p.signupPlatform,
    name: `${p.firstName || ''} ${p.lastName || ''}`.trim(),
    // After verification the name is checked against the selfie and the payout account, so it's fixed.
    nameLocked: verified || Boolean(p.payout?.method),
    phone: v.phoneVerifiedAt ? { last2: v.phoneLast2, channel: v.channel || 'whatsapp' } : null,
    country: p.country || p.profile?.countryOfResidence || null,
    emailPrefs: {
      studies: Boolean(p.receivesUpdates),
      messages: p.emailPrefs?.messages !== false,
      news: p.emailPrefs?.news === true,
    },
  };
}

/** The new email changes only when they click the link sent to it; the old address is told. */
export async function requestEmailChange(id: string, input: { email: string; password?: string }) {
  const p = await load(id, '+password');
  const email = input.email.trim().toLowerCase();
  if (email === p.email) throw new AppError('That’s already your email.', 400, 'same_email');
  await checkPassword(p, input.password);
  if (await ParticipantModel.exists({ email, _id: { $ne: p._id } })) throw new AppError('Another account already uses that email.', 409, 'email_taken');
  const token = randomToken(24);
  p.pendingEmail = email;
  p.emailChangeToken = sha256(token);
  p.emailChangeExpires = new Date(Date.now() + 24 * 3600e3);
  await p.save();
  await sendMail({
    to: email,
    subject: 'Confirm your new email for joinStudy',
    text: `Hi ${p.firstName},\n\nConfirm this is your new sign-in email (the link works for 24 hours):\n${site(`/participate/confirm-email?token=${token}`)}\n\nIf you didn't ask for this, ignore this email.`,
  });
  await sendMail({
    to: p.email,
    subject: 'Your joinStudy email is changing',
    text: `Someone asked to change the sign-in email of your joinStudy account to ${email}. It changes only when the link sent there is clicked.\n\nIf that wasn't you, change your password now and write to ${HELLO}.`,
  });
  return settings(id);
}

export async function cancelEmailChange(id: string) {
  const p = await load(id);
  p.set({ pendingEmail: undefined, emailChangeToken: undefined, emailChangeExpires: undefined });
  await p.save();
  return settings(id);
}

/** The link in the email. No sign-in needed: the token is the proof. */
export async function confirmEmailChange(token: string) {
  const p: any = await ParticipantModel.findOne({ emailChangeToken: sha256(String(token || '')) }).select('+emailChangeToken +emailChangeExpires');
  if (!p || p.closedAt || !p.pendingEmail || !p.emailChangeExpires || p.emailChangeExpires.getTime() < Date.now()) {
    throw new AppError('This link has expired. Ask for a new one in Settings.', 410, 'link_expired');
  }
  if (await ParticipantModel.exists({ email: p.pendingEmail, _id: { $ne: p._id } })) throw new AppError('Another account already uses that email.', 409, 'email_taken');
  const old = p.email;
  p.set({ email: p.pendingEmail, pendingEmail: undefined, emailChangeToken: undefined, emailChangeExpires: undefined, isVerified: true });
  await p.save();
  await sendMail({ to: old, subject: 'Your joinStudy email changed', text: `Your joinStudy sign-in email is now ${p.email}. If that wasn't you, write to ${HELLO} straight away.` });
  return { email: p.email };
}

/**
 * Signs out every other sign-in: tokens issued before now stop working, except this device's (its `sid`).
 * Returns tokens for this device (older tokens without a sign-in id get a new one).
 */
async function revokeOthers(p: any, sid?: string) {
  const keep = sid || randomToken(8);
  p.signedOutAt = new Date();
  p.keepSession = keep;
  await p.save();
  return issueTokens({ id: String(p._id), userType: 'participant', sid: keep });
}

export async function changePassword(id: string, input: { current?: string; next: string }, sid?: string) {
  const p = await load(id, '+password');
  if (p.password && !(input.current && (await comparePassword(input.current, p.password)))) throw new AppError('Your current password isn’t right.', 400, 'wrong_password');
  p.password = await hashPassword(input.next);
  p.passwordChangedAt = new Date();
  const tokens = await revokeOthers(p, sid);
  await sendMail({ to: p.email, subject: 'Your joinStudy password changed', text: `Your password was just changed, and your other devices were signed out. If that wasn't you, reset your password now and write to ${HELLO}.` });
  return tokens;
}

export async function signOutOthers(id: string, sid?: string) {
  return revokeOthers(await load(id), sid);
}

export async function setEmailPrefs(id: string, prefs: { studies?: boolean; messages?: boolean; news?: boolean }) {
  const p = await load(id);
  if (typeof prefs.studies === 'boolean') p.receivesUpdates = prefs.studies;
  if (typeof prefs.messages === 'boolean') p.set('emailPrefs.messages', prefs.messages);
  if (typeof prefs.news === 'boolean') p.set('emailPrefs.news', prefs.news);
  await p.save();
  return settings(id);
}

/** Message emails respect the participant's choice. Decisions and payments always go. */
export async function wantsMessageEmails(participantId: unknown) {
  const p: any = await ParticipantModel.findById(participantId).select('email emailPrefs closedAt');
  if (!p || p.closedAt) return null;
  return p.emailPrefs?.messages === false ? null : p.email;
}

/** Whether this participant's token is still good: not closed, and not signed out after it was issued (unless it's the kept sign-in). */
export async function sessionStillValid(id: string, issuedAtSeconds?: number, sid?: string, issuedAtMs?: number) {
  const p: any = await ParticipantModel.findById(id).select('closedAt signedOutAt keepSession');
  if (!p || p.closedAt) return false;
  if (!p.signedOutAt || (sid && sid === p.keepSession)) return true;
  const cutoff = new Date(p.signedOutAt).getTime();
  // Newer tokens carry the time in milliseconds; older ones only whole seconds, so those must be from a later second.
  return issuedAtMs ? issuedAtMs > cutoff : (issuedAtSeconds || 0) >= Math.ceil(cutoff / 1000);
}

