import AppError from '../../../error-helpers/appError';
import { randomOtp, randomToken, sha256 } from '../../../utils/hash';
import { emails, sendMail } from '../../../utils/mailer';
import { verifyFirebaseIdToken } from '../../../utils/firebase';
import { UserType } from '../../../utils/jwt';
import { AuthService } from './auth.service';
import { ParticipantModel } from '../models/participant.model';
import { ResearcherModel } from '../models/researcher.model';

/**
 * One sign-in for everyone (Stage 1, screens 1.5 and 1.6). People don't pick an account type:
 * we look the email up in both and send them to the right dashboard.
 *
 * `intent` = where they came from ("researcher" when they clicked Start a study).
 * `accountType` = an explicit choice, used when one email has both kinds of account.
 */
export const services: Record<UserType, AuthService> = {
  researcher: new AuthService(ResearcherModel, 'researcher'),
  participant: new AuthService(ParticipantModel, 'participant'),
};
const ORDER: UserType[] = ['researcher', 'participant'];
const other = (t: UserType): UserType => (t === 'researcher' ? 'participant' : 'researcher');

async function accountsFor(email: string) {
  const found = await Promise.all(ORDER.map(async (t) => ({ type: t, user: await services[t].findByEmail(email) })));
  return found.filter((f) => f.user) as { type: UserType; user: any }[];
}

type Choice = { needsChoice: true; choices: UserType[] };

export async function login(email: string, password: string, accountType?: UserType, intent?: UserType) {
  const accounts = await accountsFor(email);
  const matched: { type: UserType; user: any }[] = [];
  for (const a of accounts) if (await services[a.type].passwordMatches(a.user, password)) matched.push(a);

  if (!matched.length) {
    if (accounts.some((a) => !a.user.password && a.user.signupPlatform === 'google')) {
      throw new AppError('This account uses Google. Choose "Continue with Google".', 400, 'use_google');
    }
    throw new AppError("That email and password don't match.", 401, 'wrong_credentials');
  }

  const pick = (t?: UserType) => matched.find((m) => m.type === t);
  const chosen = pick(accountType) ?? pick(intent);
  if (chosen) return services[chosen.type].startSession(chosen.user);

  if (intent && !accountType) {
    // They came to run a study but only have a participant account (or the reverse).
    throw new AppError(
      intent === 'researcher' ? 'This email has a participant account, not a researcher account.' : 'This email has a researcher account, not a participant account.',
      409,
      `${other(intent)}_only`,
      { accountType: other(intent) }
    );
  }
  if (matched.length === 1) return services[matched[0].type].startSession(matched[0].user);
  return { needsChoice: true, choices: matched.map((m) => m.type) } as Choice;
}

export async function google(idToken: string, opts: { accountType?: UserType; intent?: UserType; method?: string }) {
  const profile = await verifyFirebaseIdToken(idToken);
  const existing = (await accountsFor(profile.email)).map((a) => a.type);
  const target = opts.accountType ?? (opts.intent && (existing.includes(opts.intent) || !existing.length || opts.intent === 'researcher') ? opts.intent : undefined);
  if (target) {
    const extra = target === 'researcher' && opts.method ? { signupIntent: { method: opts.method, source: 'google' } } : {};
    return services[target].googleAuthWithProfile(profile, extra);
  }
  if (existing.length === 1) return services[existing[0]].googleAuthWithProfile(profile);
  if (existing.length > 1) return { needsChoice: true, choices: existing } as Choice;
  throw new AppError('There is no joinStudy account for this Google email yet. Start a study or start earning to create one.', 404, 'no_account');
}

/** Resends the confirmation link for every unconfirmed account on this email. Silent otherwise. */
export async function resendVerification(email: string, accountType?: UserType) {
  const types = accountType ? [accountType] : ORDER;
  for (const t of types) await services[t].resendVerification(email);
}

/** Emails ONE code that works for every account on this email. */
export async function sendResetCode(email: string) {
  const code = randomOtp();
  const stored = (await Promise.all(ORDER.map((t) => services[t].storeOtp(email, sha256(code))))).filter(Boolean);
  if (stored.length) await sendMail({ to: stored[0].email, ...emails.otp(stored[0].firstName, code) });
}

export async function verifyResetCode(email: string, code: string) {
  const token = randomToken();
  let firstError: unknown;
  let ok = false;
  for (const a of await accountsFor(email)) {
    if (!a.user.otp) continue;
    try {
      await services[a.type].verifyOtp(email, code, token);
      ok = true;
    } catch (err) {
      firstError ??= err;
    }
  }
  if (!ok) throw firstError ?? new AppError('This code is not valid. Ask for a new one.', 400, 'invalid_code');
  return { token };
}

/** Sets the new password on every account the reset covered, then signs in (researcher first, or `intent`). */
export async function resetPassword(email: string, token: string, password: string, intent?: UserType) {
  const reset: { type: UserType; user: any }[] = [];
  for (const a of await accountsFor(email)) {
    try {
      reset.push({ type: a.type, user: await services[a.type].resetPassword(email, token, password) });
    } catch {
      /* this account wasn't part of the reset */
    }
  }
  if (!reset.length) throw new AppError('This reset has expired. Start again.', 400, 'reset_expired');
  const target = reset.find((r) => r.type === intent) ?? reset[0];
  return services[target.type].sessionAfterReset(target.user);
}
