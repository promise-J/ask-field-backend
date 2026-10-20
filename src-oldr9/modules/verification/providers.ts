import crypto from 'crypto';
import AppError from '../../error-helpers/appError';
import logger from '../../config/logger';
import { env } from '../../config/env';
import { matchesHash, randomOtp, sha256 } from '../../utils/hash';

/**
 * Participant Stage 1: the outside companies that do verification. joinStudy keeps references
 * and results only. Codes and selfies live with the provider.
 *
 * Only test providers exist until real ones are chosen (canvas notes 1.8, 1.9). They work like
 * Stripe's test mode: outside production they stand in; in production they refuse, so nobody is
 * "verified" without a real check.
 */

export type Channel = 'whatsapp' | 'sms';

export interface PhoneProvider {
  name: string;
  /** Sends a code to `to` (E.164, e.g. +2348035550142). Returns the provider's reference for this code. */
  send(to: string, channel: Channel): Promise<{ ref: string }>;
  /** Checks a code against a reference. */
  check(ref: string, code: string): Promise<'ok' | 'wrong' | 'expired'>;
}

export type SelfieOutcome = 'verified' | 'retry' | 'review' | 'duplicate';

export interface SelfieProvider {
  name: string;
  /** Opens a selfie session. `mode: 'test'` means the browser shows test controls instead of a camera SDK. */
  start(participantRef: string): Promise<{ session: string; mode: 'test' | 'sdk'; clientToken?: string }>;
  /** The outcome of a finished session. Real providers report this by webhook; the test one takes it from the request. */
  result(session: string, input: { testOutcome?: SelfieOutcome }): Promise<{ outcome: SelfieOutcome; ref: string }>;
}

const notInProduction = (what: string) => {
  if (env.NODE_ENV === 'production') {
    throw new AppError(`${what} isn't set up yet. Please try again later.`, 503, 'verification_unavailable');
  }
};

/* ---------- test phone provider: codes go to the log ---------- */

const testCodes = new Map<string, { hash: string; to: string; expires: number }>();
const lastCodeTo = new Map<string, string>();

export const testPhone: PhoneProvider = {
  name: 'test',
  async send(to, channel) {
    notInProduction('Phone verification');
    const code = randomOtp();
    const ref = crypto.randomUUID();
    testCodes.set(ref, { hash: sha256(code), to, expires: Date.now() + 10 * 60 * 1000 });
    lastCodeTo.set(to, code);
    logger.info({ to, channel, code }, `📱 Verification code ${code} for ${to} by ${channel} (test provider, not sent)`);
    return { ref };
  },
  async check(ref, code) {
    const c = testCodes.get(ref);
    if (!c || c.expires < Date.now()) return 'expired';
    if (!matchesHash(code, c.hash)) return 'wrong';
    testCodes.delete(ref);
    return 'ok';
  },
};

/** Tests only: the last code the test provider "sent" to a number. */
export const lastTestCode = (to: string) => lastCodeTo.get(to);

/* ---------- test selfie provider: you choose the result ---------- */

export const testSelfie: SelfieProvider = {
  name: 'test',
  async start() {
    notInProduction('Selfie verification');
    return { session: crypto.randomUUID(), mode: 'test' };
  },
  async result(session, input) {
    notInProduction('Selfie verification');
    return { outcome: input.testOutcome || 'verified', ref: `test_${session.slice(0, 8)}` };
  },
};

export const phoneProvider = (): PhoneProvider => testPhone;
export const selfieProvider = (): SelfieProvider => testSelfie;
