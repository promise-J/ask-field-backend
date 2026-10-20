import AppError from '../../error-helpers/appError';
import { env } from '../../config/env';
import { sendMail } from '../../utils/mailer';
import { comparePassword, hashPassword, randomToken, sha256 } from '../../utils/hash';
import { issueTokens } from '../../utils/jwt';
import { ResearcherModel } from '../user/models/researcher.model';
import { SurveyModel } from '../survey/survey.model';
import { FundingModel } from '../billing/funding.model';
import { creditBalance } from '../billing/launch.service';
import { MembershipModel } from './membership.model';
import { workspaceName } from './team.service';

/** Stage 9: a researcher's own settings (name, email, password, emails, closing), and the workspace's billing details. */

const appUrl = (path: string) => `${env.FRONTEND_URL.replace(/\/$/, '')}${path}`;
const PREFS = ['bookings', 'messages', 'review', 'finish', 'news'] as const;
type Prefs = Partial<Record<(typeof PREFS)[number], boolean>>;

async function me(selfId: string, extra = '') {
  const r: any = await ResearcherModel.findById(selfId).select(extra);
  if (!r || r.closedAt) throw new AppError('Account not found.', 404);
  return r;
}

export async function settings(selfId: string) {
  const r = await me(selfId);
  const prefs = r.emailPrefs?.toObject?.() ?? r.emailPrefs ?? {};
  return {
    firstName: r.firstName,
    lastName: r.lastName || '',
    email: r.email,
    pendingEmail: r.pendingEmail || null,
    hasPassword: r.signupPlatform !== 'google' || Boolean((await ResearcherModel.findById(selfId).select('+password'))?.get('password')),
    emailPrefs: Object.fromEntries(PREFS.map((k) => [k, prefs[k] ?? k !== 'news'])),
    organization: { name: r.organizationName || '', type: r.organizationType || '', country: r.country || '', verification: r.institutionVerification?.status || 'none' },
  };
}

export async function updateName(selfId: string, input: { firstName: string; lastName?: string }) {
  const r = await me(selfId);
  r.firstName = input.firstName.trim();
  r.lastName = (input.lastName || '').trim();
  await r.save();
  return settings(selfId);
}

/** A new email only takes effect once they click the link we send to it. */
export async function requestEmailChange(selfId: string, input: { email: string; password?: string }) {
  const r = await me(selfId, '+password');
  const email = input.email.trim().toLowerCase();
  if (email === r.email) throw new AppError('That’s already your email.', 400);
  if (r.password && !(input.password && (await comparePassword(input.password, r.password)))) throw new AppError('Your password isn’t right.', 400, 'wrong_password');
  if (await ResearcherModel.exists({ email })) throw new AppError('Another account already uses that email.', 409, 'email_taken');
  const token = randomToken(24);
  r.pendingEmail = email;
  r.emailChangeToken = sha256(token);
  r.emailChangeExpires = new Date(Date.now() + 24 * 3600e3);
  await r.save();
  await sendMail({ to: email, subject: 'Confirm your new email for joinStudy', text: `Confirm this is your new sign-in email (the link works for 24 hours): ${appUrl(`/settings/confirm-email?token=${token}`)}` });
  await sendMail({ to: r.email, subject: 'Your joinStudy email is changing', text: `Someone asked to change your sign-in email to ${email}. If that wasn't you, change your password now and email hello@joinstudy.io.` });
  return settings(selfId);
}

export async function confirmEmailChange(token: string) {
  const r: any = await ResearcherModel.findOne({ emailChangeToken: sha256(String(token || '')) }).select('+emailChangeToken +emailChangeExpires');
  if (!r || !r.pendingEmail || !r.emailChangeExpires || r.emailChangeExpires.getTime() < Date.now()) throw new AppError('This link has expired. Ask for a new one in Settings.', 410, 'link_expired');
  if (await ResearcherModel.exists({ email: r.pendingEmail, _id: { $ne: r._id } })) throw new AppError('Another account already uses that email.', 409, 'email_taken');
  r.email = r.pendingEmail;
  r.pendingEmail = undefined;
  r.emailChangeToken = undefined;
  r.emailChangeExpires = undefined;
  await r.save();
  // Invites sent to the old address stay valid for whoever holds the link; memberships are by account, not email.
  return { email: r.email };
}

/** Changes the password and signs out every other session (their refresh tokens stop working). */
export async function changePassword(selfId: string, input: { current?: string; next: string }) {
  const r = await me(selfId, '+password');
  if (r.password && !(input.current && (await comparePassword(input.current, r.password)))) throw new AppError('Your current password isn’t right.', 400, 'wrong_password');
  r.password = await hashPassword(input.next);
  r.passwordChangedAt = new Date();
  await r.save();
  await sendMail({ to: r.email, subject: 'Your joinStudy password changed', text: 'Your password was just changed, and other devices were signed out. If that wasn’t you, reset your password now and email hello@joinstudy.io.' });
  // A fresh session for this device. (Refresh tokens issued more than a second before the change stop working.)
  return issueTokens({ id: selfId, userType: 'researcher' });
}

export async function setEmailPrefs(selfId: string, prefs: Prefs) {
  const r = await me(selfId);
  for (const k of PREFS) if (typeof prefs[k] === 'boolean') r.set(`emailPrefs.${k}`, prefs[k]);
  await r.save();
  return settings(selfId);
}

/** What stops this account from closing: anything still running or holding money in its own workspace. */
export async function closeBlockers(selfId: string) {
  const [live, unsettled, invoices] = await Promise.all([
    SurveyModel.countDocuments({ userId: selfId, status: 'published' }),
    SurveyModel.countDocuments({ userId: selfId, status: 'closed', settlement: { $exists: false } }),
    FundingModel.countDocuments({ researcherId: selfId, status: 'pending', method: 'invoice' }),
  ]);
  const reasons = [
    live && `${live} live ${live === 1 ? 'study' : 'studies'}: close ${live === 1 ? 'it' : 'them'} first`,
    unsettled && `${unsettled} closed ${unsettled === 1 ? 'study' : 'studies'} still settling`,
    invoices && `${invoices} unpaid ${invoices === 1 ? 'invoice' : 'invoices'}: cancel ${invoices === 1 ? 'it' : 'them'} first`,
  ].filter(Boolean) as string[];
  return { canClose: reasons.length === 0, reasons, credit: await creditBalance(selfId) };
}

/**
 * Closes the account: sign-in stops, personal details are removed, memberships end. Studies and statements are kept
 * for finance records (anonymised to the workspace). Unused credit is refunded by the team.
 */
export async function closeAccount(selfId: string, input: { password?: string; confirm: string }) {
  const r = await me(selfId, '+password');
  if (input.confirm !== 'CLOSE') throw new AppError('Type CLOSE to confirm.', 400, 'confirm_required');
  if (r.password && !(input.password && (await comparePassword(input.password, r.password)))) throw new AppError('Your password isn’t right.', 400, 'wrong_password');
  const b = await closeBlockers(selfId);
  if (!b.canClose) throw new AppError(`You can’t close your account yet: ${b.reasons.join('; ')}.`, 409, 'cannot_close', b);
  const oldEmail = r.email;
  if (b.credit > 0) await sendMail({ to: env.REVIEW_INBOX || env.LEADS_INBOX || 'hello@joinstudy.io', subject: 'Credit to refund for a closed account', text: `${oldEmail} (${selfId}) closed their account with ${env.DEFAULT_CURRENCY} ${b.credit.toFixed(2)} credit. Refund it.` });
  await MembershipModel.updateMany({ $or: [{ researcherId: selfId }, { workspaceId: selfId }], status: { $in: ['invited', 'active'] } }, { $set: { status: 'removed' } });
  r.set({ email: `closed+${selfId}@joinstudy.invalid`, firstName: 'Closed', lastName: 'account', password: undefined, googleId: undefined, closedAt: new Date(), passwordChangedAt: new Date(), pendingEmail: undefined, billingDetails: undefined });
  await r.save({ validateBeforeSave: false });
  await sendMail({ to: oldEmail, subject: 'Your joinStudy account is closed', text: `Your account is closed and you've been signed out.${b.credit > 0 ? ' We’ll refund your unused credit within 14 days.' : ''} Your study statements are kept for 7 years for finance records. Questions: hello@joinstudy.io` });
  return { closed: true };
}

// ---------------------------------------------------------------- billing (workspace)

export async function billingDetails(workspaceId: string) {
  const r: any = await ResearcherModel.findById(workspaceId).select('firstName lastName email organizationName country billingDetails');
  const b = r?.billingDetails?.toObject?.() ?? r?.billingDetails ?? {};
  return {
    saved: Boolean(b.email),
    name: b.name || [r?.firstName, r?.lastName].filter(Boolean).join(' '),
    organization: b.organization ?? r?.organizationName ?? '',
    email: b.email || r?.email || '',
    cc: b.cc || '',
    reference: b.reference || '',
    country: b.country || r?.country || '',
  };
}

export async function saveBillingDetails(workspaceId: string, input: Record<string, string>) {
  await ResearcherModel.updateOne({ _id: workspaceId }, { $set: { billingDetails: { name: input.name, organization: input.organization || '', email: input.email, cc: input.cc || '', reference: input.reference || '', country: input.country } } });
  return billingDetails(workspaceId);
}

const cell = (v: unknown) => {
  const t = v == null ? '' : String(v);
  return /[",\n\r]/.test(t) || /^[=+\-@]/.test(t) ? `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"` : t;
};

/** Every payment in a year, for a finance office. */
export async function paymentsCsv(workspaceId: string, year: number) {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const list: any[] = await FundingModel.find({ researcherId: workspaceId, status: { $in: ['paid', 'refunded'] }, paidAt: { $gte: from, $lt: to } }).sort({ paidAt: 1 });
  const studies = new Map((await SurveyModel.find({ _id: { $in: list.map((f) => f.surveyId) } }).select('plan.basics.title surveyName')).map((s: any) => [String(s._id), s.plan?.basics?.title || s.surveyName]));
  const payers = new Map((await ResearcherModel.find({ _id: { $in: list.map((f) => f.paidBy).filter(Boolean) } }).select('firstName lastName')).map((p: any) => [String(p._id), [p.firstName, p.lastName].filter(Boolean).join(' ')]));
  const head = ['date', 'number', 'study', 'what', 'method', 'card_last4', 'paid_by', 'amount', 'credit_used', 'refunded_to_card', 'currency', 'reference', 'status'];
  const rows = list.map((f) => [
    new Date(f.paidAt).toISOString().slice(0, 10),
    f.number || '',
    studies.get(String(f.surveyId)) || '',
    f.purpose === 'add-places' ? `${f.extraPlaces} more places` : 'launch',
    f.method,
    f.cardLast4 || '',
    payers.get(String(f.paidBy)) || '',
    (f.amount || 0).toFixed(2),
    (f.creditUsed || 0).toFixed(2),
    (f.refunded || 0).toFixed(2),
    f.currency,
    f.receipt?.reference || '',
    f.status,
  ]);
  const name = (await workspaceName(workspaceId)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
  return { csv: '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n', filename: `joinstudy-payments-${name}-${year}.csv` };
}
