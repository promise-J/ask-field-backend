import AppError from '../../../error-helpers/appError';
import { config } from '../../../config/env';
import { matchesHash, randomOtp, sha256 } from '../../../utils/hash';
import { emails, sendMail } from '../../../utils/mailer';
import { isAcademicDomain } from '../../../utils/academic';
import { ResearcherModel } from '../models/researcher.model';
import { VERIFIABLE_ORG_TYPES } from '../user.validation';

/**
 * Stage 2: "Tell us about your work" (2.1) and "Verify your institution" (2.2).
 * See the joinStudy Researcher Flow canvas.
 */
const CODE_GAP_SECONDS = 60;
const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const SECRETS = '+institutionCode +institutionCodeExpires +institutionCodeAttempts +institutionCodeSentAt';

async function load(id: string, withSecrets = false) {
  const q = ResearcherModel.findById(id);
  const user = await (withSecrets ? q.select(SECRETS) : q);
  if (!user) throw new AppError('Account not found.', 404, 'not_found');
  return user as any;
}

const canVerify = (user: any) => VERIFIABLE_ORG_TYPES.includes(user.organizationType);
const status = (user: any) => user.institutionVerification?.status ?? 'none';

function markVerified(user: any, method: string, email?: string) {
  user.set('institutionVerification', {
    status: 'verified',
    method,
    email,
    requestedAt: user.institutionVerification?.requestedAt ?? new Date(),
    verifiedAt: new Date(),
  });
}

/** What the setup page shows next: the verification step, or the dashboard. */
function nextStep(user: any) {
  return canVerify(user) && status(user) !== 'verified' ? 'verify' : 'dashboard';
}

export async function saveProfile(id: string, data: Record<string, any>) {
  const user = await load(id);
  user.set({
    organizationType: data.organizationType,
    organizationName: data.organizationType === 'independent' ? '' : data.organizationName,
    country: data.country,
    role: data.role,
    researchAreas: data.researchAreas,
    firstMethod: data.firstMethod ?? user.firstMethod,
    heardFrom: data.heardFrom,
    isCompleteProfile: true,
    profileCompletedAt: user.profileCompletedAt ?? new Date(),
  });
  // A recognised university email verifies them straight away (2.2, first state).
  if (canVerify(user) && status(user) !== 'verified' && isAcademicDomain(user.email)) {
    markVerified(user, 'sign-in-email', user.email);
  }
  await user.save();
  return { user: user.toJSON(), next: nextStep(user) };
}

/** Sends a 6-digit code to a work email (2.2, "Confirm your work email"). */
export async function startWorkEmail(id: string, email: string) {
  const user = await load(id, true);
  if (!canVerify(user)) throw new AppError('Verification is for universities, research institutes, non-profits and government.', 400, 'not_eligible');
  if (status(user) === 'verified') return { alreadyVerified: true };
  const last = user.institutionCodeSentAt ? new Date(user.institutionCodeSentAt).getTime() : 0;
  const wait = Math.ceil((last + CODE_GAP_SECONDS * 1000 - Date.now()) / 1000);
  if (wait > 0) throw new AppError(`Please wait ${wait} seconds before asking for another code.`, 429, 'too_soon', { retryAfter: wait });

  const code = randomOtp();
  user.institutionCode = sha256(code);
  user.institutionCodeExpires = new Date(Date.now() + CODE_TTL_MS);
  user.institutionCodeAttempts = 0;
  user.institutionCodeSentAt = new Date();
  user.set('institutionVerification.email', email.toLowerCase().trim());
  if (status(user) === 'none' || status(user) === 'rejected') user.set('institutionVerification.status', 'none');
  await user.save();
  await sendMail({ to: email, ...emails.workEmailCode(user.firstName, code) });
  return { alreadyVerified: false, email: email.toLowerCase().trim(), academic: isAcademicDomain(email) };
}

/**
 * Checks the code. An academic domain verifies at once; any other address (an NGO or ministry, say) proves
 * the email but goes to a person for review.
 */
export async function confirmWorkEmail(id: string, code: string) {
  const user = await load(id, true);
  const email = user.institutionVerification?.email;
  if (!user.institutionCode || !email) throw new AppError('Ask for a code first.', 400, 'no_code');
  if ((user.institutionCodeAttempts ?? 0) >= MAX_ATTEMPTS) throw new AppError('Too many attempts. Ask for a new code.', 429, 'too_many_attempts');
  if (!user.institutionCodeExpires || new Date(user.institutionCodeExpires).getTime() < Date.now()) {
    throw new AppError('This code has expired. Ask for a new one.', 400, 'code_expired');
  }
  if (!matchesHash(code, user.institutionCode)) {
    user.institutionCodeAttempts = (user.institutionCodeAttempts ?? 0) + 1;
    await user.save();
    throw new AppError("That code isn't right. Check it and try again.", 400, 'wrong_code');
  }
  user.institutionCode = undefined;
  user.institutionCodeExpires = undefined;
  user.institutionCodeAttempts = 0;
  if (isAcademicDomain(email)) markVerified(user, 'work-email', email);
  else user.set('institutionVerification', { status: 'pending', method: 'work-email', email, requestedAt: new Date() });
  await user.save();
  return { user: user.toJSON(), status: status(user) };
}

/** A staff or student page for a person at joinStudy to check (2.2, "Share a staff or student page"). */
export async function submitStaffLink(id: string, url: string) {
  const user = await load(id);
  if (!canVerify(user)) throw new AppError('Verification is for universities, research institutes, non-profits and government.', 400, 'not_eligible');
  if (status(user) === 'verified') return { user: user.toJSON(), status: 'verified' };
  user.set('institutionVerification', { status: 'pending', method: 'link', url, email: user.institutionVerification?.email, requestedAt: new Date() });
  await user.save();
  return { user: user.toJSON(), status: 'pending' };
}

/** For whoever reviews pending requests (scripts/review-verification.ts until there's an admin screen). */
export async function reviewVerification(email: string, decision: 'verified' | 'rejected', note?: string) {
  const user = (await ResearcherModel.findOne({ email: email.toLowerCase().trim() })) as any;
  if (!user) throw new AppError('No researcher with that email.', 404, 'not_found');
  user.set('institutionVerification.status', decision);
  user.set('institutionVerification.note', note);
  if (decision === 'verified') user.set('institutionVerification.verifiedAt', new Date());
  await user.save();
  return user.toJSON();
}

/** The fee added to rewards when this researcher approves work. */
export async function feeRateFor(researcherId: string) {
  const user = (await ResearcherModel.findById(researcherId)) as any;
  const academic = user && canVerify(user) && status(user) === 'verified';
  return academic ? config.academicFeeRate : config.platformFeeRate;
}

