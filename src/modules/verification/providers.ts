import crypto from 'crypto';
import AppError from '../../error-helpers/appError';
import logger from '../../config/logger';
import { config, env } from '../../config/env';
import { matchesHash, randomOtp, sha256 } from '../../utils/hash';

/**
 * Participant Stage 1: the outside companies that do verification. joinStudy keeps references
 * and results only. Codes and selfies live with the provider.
 *
 * - Phone: Termii (PHONE_PROVIDER=termii). SMS codes use Termii's Token API (Termii makes and checks the code).
 *   WhatsApp codes use Termii's WhatsApp OTP route when TERMII_WHATSAPP_FROM is set; otherwise they go by SMS.
 * - Selfie: Smile ID SmartSelfie registration (SELFIE_PROVIDER=smileid): liveness in the browser (Smile ID's web SDK),
 *   the result by webhook, and Smile Secure flags a face that's already on another account.
 * - Test providers stand in outside production, like Stripe's test mode; in production they refuse,
 *   so nobody is "verified" without a real check.
 */

export type Channel = 'whatsapp' | 'sms';

export interface PhoneProvider {
  name: string;
  /** Sends a code to `to` (E.164, e.g. +2348035550142). Returns the provider's reference, and the channel actually used. */
  send(to: string, channel: Channel): Promise<{ ref: string; channel?: Channel }>;
  /** Checks a code against a reference. */
  check(ref: string, code: string): Promise<'ok' | 'wrong' | 'expired'>;
}

export type SelfieOutcome = 'verified' | 'retry' | 'review' | 'duplicate';

/** What the browser needs to open Smile ID's camera (window.SmileIdentity). */
export interface SelfieSdk {
  provider: 'smileid';
  product: 'smartselfie';
  environment: 'sandbox' | 'production';
  partnerId: string;
  callbackUrl: string;
  partner: { name: string; logoUrl: string; policyUrl: string };
}

export interface SelfieProvider {
  name: string;
  /** Opens a selfie session. `mode: 'test'` shows test controls; `mode: 'sdk'` opens the provider's camera with `clientToken`. */
  start(participantRef: string): Promise<{ session: string; mode: 'test' | 'sdk'; clientToken?: string; sdk?: SelfieSdk }>;
  /**
   * The outcome of a finished session. The test one takes it from the request; real providers report by webhook,
   * so this returns 'pending' until the webhook arrives.
   */
  result(session: string, input: { testOutcome?: SelfieOutcome }): Promise<{ outcome: SelfieOutcome | 'pending'; ref: string }>;
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

/* ---------- Termii (SMS and WhatsApp codes) ---------- */

const CODE_MINUTES = 10;
const digits = (e164: string) => e164.replace(/^\+/, '');
/** Our own WhatsApp codes: only a keyed hash and the expiry are kept, inside the reference. */
const waHash = (ref: string, code: string) => crypto.createHmac('sha256', config.phoneHashSecret).update(`${ref}:${code}`).digest('hex');

import axios from 'axios';

async function termii(path: string, body: Record<string, unknown>) {
  if (!env.TERMII_API_KEY) {
    throw new AppError('Phone verification isn’t set up yet. Please try again later.', 503, 'verification_unavailable');
  }

  // Clean the base URL and join it with the path safely
  const baseUrl = env.TERMII_BASE_URL.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const fullUrl = `${baseUrl}${cleanPath}`;

  // 🔍 DEBUG LOG: See the exact URL being built
  console.log('🚀 Termii Request Details:', {
    builtFullUrl: fullUrl,
    configuredBaseUrl: env.TERMII_BASE_URL,
    passedPath: path
  });

  try {
    const response = await axios.post(
      fullUrl,
      {
        api_key: env.TERMII_API_KEY,
        ...body,
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000, // 15 seconds timeout matching your AbortSignal
      }
    );

    return { 
      ok: true, 
      status: response.status, 
      data: response.data 
    };
  } catch (error: any) {
    // Log the breakdown of what failed
    
    throw new AppError('We couldn’t send the code just now. Try again in a minute.', 502, 'sms_failed');
  }
}


export const termiiPhone: PhoneProvider = {
  name: 'termii',
  async send(to, channel) {
    // 1. If it's a WhatsApp request, keep your custom working logic
    if (channel === 'whatsapp' && env.TERMII_WHATSAPP_FROM) {
      const code = randomOtp();
      const id = crypto.randomUUID();
      const expires = Date.now() + CODE_MINUTES * 60 * 1000;
      const r = await termii('/api/sms/send', { 
        to: digits(to), // ensure digits format
        from: env.TERMII_WHATSAPP_FROM, 
        sms: `Your joinStudy code is ${code}. It expires in ${CODE_MINUTES} minutes. Never share it with anyone.`, 
        type: 'plain', 
        channel: 'whatsapp_otp' 
      });
      if (!r.ok || (r.data.code && r.data.code !== 'ok')) {
        logger.error({ status: r.status, data: r.data }, 'Termii WhatsApp code failed');
        throw new AppError('We couldn’t send a WhatsApp code to this number. Try “Text me instead”.', 502, 'whatsapp_failed');
      }
      return { ref: `wa:${id}:${expires}:${waHash(id, code)}`, channel: 'whatsapp' };
    }

    // 2. Standard SMS Flow (Patterned after your working script)
    if (!env.TERMII_SENDER_ID) {
      throw new AppError('Phone verification isn’t set up yet. Please try again later.', 503, 'verification_unavailable');
    }

    // Generate a real OTP code locally so we can track it natively
    const code = randomOtp(); 
    const id = crypto.randomUUID();
    const expires = Date.now() + CODE_MINUTES * 60 * 1000;
    const message = `Your joinStudy code is ${code}. It expires in ${CODE_MINUTES} minutes. Never share it with anyone.`;

    // Format phone number exactly like your working script (e.g., stripping + and adding 234)
    let formattedPhone = to.replace(/\D/g, "");
    if (formattedPhone.startsWith("0")) {
      formattedPhone = "234" + formattedPhone.slice(1);
    }

    // Hit the generic SMS endpoint with the compiled message containing the actual code
    const r = await termii('/api/sms/send', {
      to: formattedPhone,
      from: env.TERMII_SENDER_ID,
      channel: env.TERMII_CHANNEL || 'generic', // Fallback to 'generic' like your script
      type: 'plain',
      sms: message,
    });

    // Check if the delivery payload succeeded from the response body 
    // Termii's generic send returns data like { message_id: "...", status: 200 } on success
    if (!r.ok || (r.data.code && r.data.code !== 'ok' && !r.data.message_id)) {
      logger.error({ status: r.status, data: r.data }, 'Termii SMS code failed');
      throw new AppError('We couldn’t send a text to this number. Check it and try again.', 502, 'sms_failed');
    }

    // Return a statutory custom reference string containing the hash, identical to your WhatsApp strategy
    return { ref: `sms:${id}:${expires}:${waHash(id, code)}`, channel: 'sms' };
  },

  async check(ref, code) {
    // Both routes now verify instantly using your local crypto hmac signature
    if (ref.startsWith('wa:') || ref.startsWith('sms:')) {
      const [, id, expires, hash] = ref.split(':');
      
      if (Number(expires) < Date.now()) return 'expired';
      
      const ok = crypto.timingSafeEqual(Buffer.from(waHash(id, code)), Buffer.from(hash));
      return ok ? 'ok' : 'wrong';
    }
    
    return 'expired';
  },
};


/* ---------- Smile ID (selfie: liveness + one face per account) ---------- */

const smileBase = () => (env.SMILEID_BASE_URL || (env.SMILEID_ENV === 'production' ? 'https://api.smileidentity.com' : 'https://testapi.smileidentity.com')).replace(/\/$/, '');

export const smileSelfie: SelfieProvider = {
  name: 'smileid',
  async start(participantRef) {
    if (!env.SMILEID_PARTNER_ID || !env.SMILEID_API_KEY || !env.SMILEID_CALLBACK_URL) {
      throw new AppError('Selfie verification isn’t set up yet. Please try again later.', 503, 'verification_unavailable');
    }
    const jobId = `js_${crypto.randomUUID()}`;
    const form = new FormData();
    form.append('user_id', participantRef);
    form.append('product', 'smart_selfie_registration');
    form.append('partner_params', JSON.stringify({ job_id: jobId, user_id: participantRef }));
    form.append('payload', JSON.stringify({ callback_url: env.SMILEID_CALLBACK_URL }));
    let res: Response;
    try {
      res = await fetch(`${smileBase()}/v3/token`, {
        method: 'POST',
        headers: { 'smileid-partner-id': env.SMILEID_PARTNER_ID, 'smileid-api-key': env.SMILEID_API_KEY },
        body: form,
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      logger.error({ error }, 'Smile ID could not be reached');
      throw new AppError('The selfie check isn’t available right now. Try again in a minute.', 502, 'selfie_unavailable');
    }
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) {
      logger.error({ status: res.status, data }, 'Smile ID token failed');
      throw new AppError('The selfie check isn’t available right now. Try again in a minute.', 502, 'selfie_unavailable');
    }
    return {
      session: jobId,
      mode: 'sdk',
      clientToken: data.token,
      sdk: {
        provider: 'smileid',
        product: 'smartselfie',
        environment: env.SMILEID_ENV,
        partnerId: env.SMILEID_PARTNER_ID,
        callbackUrl: env.SMILEID_CALLBACK_URL,
        partner: { name: env.SMILEID_COMPANY_NAME, logoUrl: env.SMILEID_LOGO_URL, policyUrl: env.SMILEID_POLICY_URL },
      },
    };
  },
  // The result comes by webhook (smileWebhookOutcome); until then the selfie is being checked.
  async result(session) {
    return { outcome: 'pending', ref: session };
  },
};

/** A webhook really from Smile ID: base64 HMAC-SHA256 of timestamp + partner ID + "sid_request", keyed with the API key. */
export function smileSignatureOk(timestamp?: string, signature?: string) {
  if (!timestamp || !signature || !env.SMILEID_PARTNER_ID || !env.SMILEID_API_KEY) return false;
  const expected = crypto.createHmac('sha256', env.SMILEID_API_KEY).update(timestamp + env.SMILEID_PARTNER_ID + 'sid_request').digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Turns a SmartSelfie registration webhook into our outcome.
 * status: clear | attention | block | error. smile_secure.status 'attention' with reason 'same-face' = another account.
 */
export function smileOutcome(body: any): { jobId: string | null; outcome: SelfieOutcome; ref: string } {
  const jobId = body?.partner_params?.job_id || null;
  const ref = String(body?.smile_job_id || body?.job_id || body?.id || jobId || '');
  const secure = body?.smile_secure || body?.antifraud?.smile_secure || {};
  const sameFace = JSON.stringify(secure.suspect_users || secure.reasons || []).includes('same-face');
  const status = String(body?.status || '').toLowerCase();
  if (sameFace || (secure.status === 'attention' && (secure.suspect_users || []).length)) return { jobId, outcome: 'duplicate', ref };
  if (status === 'clear') return { jobId, outcome: 'verified', ref };
  if (status === 'attention') return { jobId, outcome: 'review', ref };
  return { jobId, outcome: 'retry', ref }; // block (liveness failed) or error: try again
}

export const phoneProvider = (): PhoneProvider => (env.PHONE_PROVIDER === 'termii' ? termiiPhone : testPhone);
export const selfieProvider = (): SelfieProvider => (env.SELFIE_PROVIDER === 'smileid' ? smileSelfie : testSelfie);
