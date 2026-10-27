import { qualifyingFor } from '../studies/studies.service';
import crypto from 'crypto';
import AppError from '../../error-helpers/appError';
import { config, env } from '../../config/env';
import { ParticipantModel } from '../user/models/participant.model';
import { sendMail } from '../../utils/mailer';
import { Channel, phoneProvider, selfieProvider, SelfieOutcome } from './providers';
import { VERIFY_FIRST } from './gate';
import { closedRecently } from '../account/settings.service';
export { assertCanTakeStudies } from './gate';

/**
 * Participant Stage 1, canvas 1.7–1.9: verify once, before the first study.
 *
 * 1. Consent (the selfie is sensitive data).
 * 2. A WhatsApp or SMS code proves the number. One number per account.
 * 3. A selfie: liveness, and the provider compares the face with every other account.
 *
 * Asked for only when someone qualifies for an open study, so we never pay to verify a person
 * who never gets one. Done once; never per study.
 */

const MAX_CODE_ATTEMPTS = 5;
const SEND_GAP_MS = 30 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_SELFIE_TRIES = 3;

/** Calling codes and national number lengths for the participant countries. */
const PHONE_RULES: Record<string, { code: string; digits: number[] }> = {
  Nigeria: { code: '234', digits: [10] },
  Ghana: { code: '233', digits: [9] },
  Kenya: { code: '254', digits: [9] },
};

/** Turns what people type (0803…, +234 803…, 234803…) into E.164 for their country. */
export function normalisePhone(raw: string, country?: string) {
  const rule = PHONE_RULES[country || ''];
  if (!rule) throw new AppError('Choose where you live first.', 400, 'country_needed');
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) {
    d = d.slice(1);
    if (!d.startsWith(rule.code)) throw new AppError(`Use a ${country} number (it starts with +${rule.code}).`, 400, 'wrong_country');
    d = d.slice(rule.code.length);
  } else if (d.startsWith(rule.code) && rule.digits.includes(d.length - rule.code.length)) {
    d = d.slice(rule.code.length);
  }
  if (d.startsWith('0')) d = d.slice(1);
  if (!/^\d+$/.test(d) || !rule.digits.includes(d.length)) throw new AppError(`That doesn't look like a ${country} mobile number.`, 400, 'bad_phone');
  return `+${rule.code}${d}`;
}

/** Keyed hash: enough to refuse a number on a second account, impossible to read back. */
export const phoneHash = (e164: string) => crypto.createHmac('sha256', config.phoneHashSecret).update(e164).digest('hex');


/** How many open studies this person qualifies for right now (the "You qualify for 3 studies" line). */
export const qualifying = (participant: any) => qualifyingFor(participant);

async function load(id: string, secrets = false) {
  const q = ParticipantModel.findById(id);
  if (secrets) q.select('+verification.phoneHash +verification.pending +verification.sends +verification.selfieSession');
  const p: any = await q;
  if (!p) throw new AppError('Account not found.', 404);
  if (!p.verification) p.verification = {};
  return p;
}

export async function status(participantId: string) {
  const p = await load(participantId);
  const v = p.verification || {};
  return {
    required: env.REQUIRE_PARTICIPANT_VERIFICATION,
    status: v.status || 'none',
    consented: Boolean(v.consentAt),
    phoneVerified: Boolean(v.phoneVerifiedAt),
    phoneLast2: v.phoneLast2 || null,
    channel: v.channel || null,
    selfieTriesLeft: Math.max(0, MAX_SELFIE_TRIES - (v.selfieAttempts || 0)),
    verifiedAt: v.verifiedAt || null,
    country: p.country || p.profile?.countryOfResidence || null,
    callingCode: PHONE_RULES[p.country || '']?.code || null,
    qualifying: await qualifying(p),
    testMode: { phone: phoneProvider().name === 'test', selfie: selfieProvider().name === 'test' },
  };
}

const done = (p: any) => ['verified', 'duplicate', 'rejected'].includes(p.verification?.status);

export async function consent(participantId: string) {
  const p = await load(participantId);
  if (!p.verification.consentAt) p.verification.consentAt = new Date();
  await p.save();
  return status(participantId);
}

/**
 * Sends a code to confirm a number. `change` (Participant Stage 7, Settings) replaces a number they already confirmed;
 * the same one-account-per-number rule applies.
 */
export async function sendCode(participantId: string, raw: string, channel: Channel, opts: { change?: boolean } = {}) {
  const p = await load(participantId, true);
  const v = p.verification;
  if (opts.change) {
    if (!v.phoneVerifiedAt) throw new AppError('Confirm a number first, when you get verified.', 409, 'no_phone');
  } else {
    if (done(p)) throw new AppError('You’re already verified.', 409, 'already_done');
    if (!v.consentAt) throw new AppError('Agree to the check first.', 409, 'consent_needed');
  }
  const country = p.country || p.profile?.countryOfResidence;
  const e164 = normalisePhone(raw, country);
  const hash = phoneHash(e164);
  if (opts.change && hash === v.phoneHash) throw new AppError('That’s already your number.', 400, 'same_phone');
  await assertPhoneFree(p._id, hash);

  const now = Date.now();
  const recent = (v.sends || []).filter((d: Date) => now - new Date(d).getTime() < 60 * 60 * 1000);
  const last = recent.length ? new Date(recent[recent.length - 1]).getTime() : 0;
  if (now - last < SEND_GAP_MS) {
    const wait = Math.ceil((last + SEND_GAP_MS - now) / 1000);
    throw new AppError(`Please wait ${wait} seconds before asking for another code.`, 429, 'too_soon', { retryAfter: wait });
  }
  if (recent.length >= MAX_SENDS_PER_HOUR) throw new AppError('Too many codes in the last hour. Try again later.', 429, 'too_many_codes');

  const { ref } = await phoneProvider().send(e164, channel);
  v.pending = { ref, phoneHash: hash, phoneLast2: e164.slice(-2), channel, sentAt: new Date(), attempts: 0 };
  v.sends = [...recent, new Date()];
  p.markModified('verification');
  await p.save();
  return { sentTo: `+${PHONE_RULES[country].code} ••• ••• ••${e164.slice(-2)}`, channel, retryAfter: SEND_GAP_MS / 1000 };
}

export async function checkCode(participantId: string, code: string) {
  const p = await load(participantId, true);
  const v = p.verification;
  const pending = v.pending;
  if (!pending?.ref) throw new AppError('Ask for a code first.', 409, 'no_code');
  if ((pending.attempts || 0) >= MAX_CODE_ATTEMPTS) throw new AppError('Too many tries. Ask for a new code.', 429, 'too_many_attempts');
  const result = await phoneProvider().check(pending.ref, code);
  if (result !== 'ok') {
    pending.attempts = (pending.attempts || 0) + 1;
    p.markModified('verification');
    await p.save();
    if (result === 'expired') throw new AppError('This code has expired. Ask for a new one.', 400, 'code_expired');
    throw new AppError("That code isn't right. Check it and try again.", 400, 'wrong_code');
  }
  // Someone else may have verified the same number while this code was in flight.
  await assertPhoneFree(p._id, pending.phoneHash);
  const changed = Boolean(v.phoneVerifiedAt && v.phoneHash && v.phoneHash !== pending.phoneHash);
  v.phoneHash = pending.phoneHash;
  v.phoneLast2 = pending.phoneLast2;
  v.channel = pending.channel;
  v.phoneVerifiedAt = new Date();
  v.pending = undefined;
  if (!v.status || v.status === 'none') v.status = 'phone';
  p.markModified('verification');
  await p.save();
  if (changed) {
    await sendMail({ to: p.email, subject: 'Your joinStudy WhatsApp number changed', text: `Your number is now the one ending ${v.phoneLast2}. If you didn't make this change, write to hello@joinstudy.io straight away.` });
  }
  return status(participantId);
}

async function assertPhoneFree(selfId: unknown, hash: string) {
  if (await ParticipantModel.exists({ _id: { $ne: selfId }, 'verification.phoneHash': hash })) {
    throw new AppError('This number is already on another joinStudy account. Each person can have one account.', 409, 'phone_taken');
  }
  // Participant Stage 7: numbers from accounts closed in the last 12 months can't be used again yet.
  if (await closedRecently('phone', hash)) {
    throw new AppError('This number was on a joinStudy account that was closed in the last 12 months, so it can’t be used yet. If this is a mistake, contact us.', 409, 'phone_closed');
  }
}

export async function startSelfie(participantId: string) {
  const p = await load(participantId, true);
  const v = p.verification;
  if (done(p)) throw new AppError('You’re already verified.', 409, 'already_done');
  if (!v.phoneVerifiedAt) throw new AppError('Confirm your number first.', 409, 'phone_needed');
  if (v.status === 'review') throw new AppError(VERIFY_FIRST.review, 409, 'in_review');
  if ((v.selfieAttempts || 0) >= MAX_SELFIE_TRIES) return toReview(p, 'Three selfie tries didn’t pass.');
  const s = await selfieProvider().start(String(p._id));
  v.selfieSession = s.session;
  v.selfieProvider = selfieProvider().name;
  p.markModified('verification');
  await p.save();
  return { session: s.session, mode: s.mode, clientToken: s.clientToken };
}

async function toReview(p: any, note: string) {
  p.verification.status = 'review';
  p.verification.reviewNote = note;
  p.markModified('verification');
  await p.save();
  await sendMail({ to: env.REVIEW_INBOX || env.LEADS_INBOX, subject: 'Participant verification to review', text: `${p.email} (${p._id}): ${note}\nDecide with: npm run review-participant -- approve|reject|duplicate ${p.email}` });
  return { session: null, mode: 'review' as const };
}

/** Applies a selfie result. Real providers call this from their webhook; the test provider from the browser. */
export async function applySelfieOutcome(p: any, outcome: SelfieOutcome, ref?: string) {
  const v = p.verification;
  if (ref) v.selfieRef = ref;
  v.selfieSession = undefined;
  if (outcome === 'verified') {
    v.status = 'verified';
    v.verifiedAt = new Date();
  } else if (outcome === 'duplicate') {
    v.status = 'duplicate';
  } else if (outcome === 'review') {
    p.markModified('verification');
    await toReview(p, 'The automatic check wasn’t sure.');
    return;
  } else {
    v.selfieAttempts = (v.selfieAttempts || 0) + 1;
    if (v.selfieAttempts >= MAX_SELFIE_TRIES) {
      p.markModified('verification');
      await toReview(p, 'Three selfie tries didn’t pass.');
      return;
    }
  }
  p.markModified('verification');
  await p.save();
}

export async function completeSelfie(participantId: string, session: string, testOutcome?: SelfieOutcome) {
  const p = await load(participantId, true);
  const v = p.verification;
  if (!v.selfieSession || v.selfieSession !== session) throw new AppError('This selfie session has ended. Start again.', 409, 'session_ended');
  const r = await selfieProvider().result(session, { testOutcome });
  await applySelfieOutcome(p, r.outcome, r.ref);
  return status(participantId);
}

/** Our team's decision on a selfie a person had to look at (npm run review-participant). */
export async function decideReview(email: string, decision: 'approve' | 'reject' | 'duplicate') {
  const p: any = await ParticipantModel.findOne({ email: email.toLowerCase().trim() });
  if (!p) throw new Error(`No participant with email ${email}`);
  if (!p.verification) p.verification = {};
  p.verification.status = decision === 'approve' ? 'verified' : decision === 'duplicate' ? 'duplicate' : 'rejected';
  if (decision === 'approve') p.verification.verifiedAt = new Date();
  p.markModified('verification');
  await p.save();
  const text =
    decision === 'approve'
      ? 'You’re verified on joinStudy. Sign in to see the studies you qualify for.'
      : decision === 'duplicate'
        ? 'Your selfie matches another joinStudy account. Everyone can have one account, so please sign in to that one.'
        : 'We couldn’t verify this joinStudy account. Reply to this email if you think that’s a mistake.';
  await sendMail({ to: p.email, subject: decision === 'approve' ? 'You’re verified' : 'About your joinStudy verification', text });
  return p.verification.status;
}
