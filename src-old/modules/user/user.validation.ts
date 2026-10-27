import { z } from 'zod';
import { config } from '../../config/env';

const email = z.string().trim().email('Enter a valid email address.');
const name = (label: string) => z.string().trim().min(1, `${label} is required.`).max(80);

/** Participant countries are a setting (PARTICIPANT_COUNTRIES); anywhere else joins the waitlist. */
export const participantCountry = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() : ''),
  z.string().refine((c) => c.length > 0, 'Choose where you live.').refine((c) => !c || config.participantCountries.includes(c), 'We can only pay people in Nigeria, Ghana and Kenya for now. Join the waitlist for your country.')
);

/** One box covers age and terms (canvas 1.2). */
const agree = z.any().refine((v) => v === true, "Tick the box to confirm you're 18 or older and agree to the terms.");

/** Participant Stage 1: one sign-up screen (canvas 1.2). `agree` becomes the time they agreed. */
export const registerParticipantSchema = z
  .object({
    email,
    password: z.string().min(8, 'Password must be at least 8 characters.'),
    firstName: name('First name'),
    lastName: name('Last name'),
    country: participantCountry,
    agree,
    receivesUpdates: z.boolean().optional(),
    turnstileToken: z.string().max(4096).optional(),
  })
  .transform(({ agree: _a, turnstileToken: _t, ...rest }) => ({ ...rest, agreedTermsAt: new Date() }));

/** Joining the waitlist from outside the participant countries (canvas 1.1). */
export const participantWaitlistSchema = z.object({
  email,
  country: z.string().trim().min(2, 'Choose your country.').max(80),
});

/** Fixing a mistyped email before it's confirmed (canvas 1.3). The password proves it's their sign-up. */
export const changeUnconfirmedEmailSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.'),
  newEmail: email,
});

const METHODS = ['survey', 'interview', 'focus-group', 'product-test'] as const;

/**
 * Stage 1 sign-up is one screen: full name, work email, password. Older clients may still send
 * firstName/lastName and the organisation fields, so both shapes are accepted.
 */
export const registerResearcherSchema = z
  .object({
    email,
    password: z.string().min(8, 'Password must be at least 8 characters.'),
    fullName: z.string().trim().max(160).optional(),
    firstName: z.string().trim().max(80).optional(),
    lastName: z.string().trim().max(80).optional(),
    receivesUpdates: z.boolean().optional().default(false),
    method: z.enum(METHODS).optional(),
    source: z.string().trim().max(40).optional(),
    jobTitle: z.string().trim().max(120).optional(),
    organizationName: z.string().trim().max(160).optional(),
    organizationType: z.string().trim().max(80).optional(),
    country: z.string().trim().max(80).optional(),
  })
  .transform((v, ctx) => {
    let first = v.firstName ?? '';
    let last = v.lastName ?? '';
    if (v.fullName) {
      const parts = v.fullName.split(/\s+/).filter(Boolean);
      first = parts[0] ?? '';
      last = parts.slice(1).join(' ');
    }
    if (!first) ctx.addIssue({ code: 'custom', message: 'Enter your name.', path: ['fullName'] });
    const { fullName: _f, method, source, ...rest } = v;
    return {
      ...rest,
      firstName: first,
      lastName: last,
      signupIntent: method || source ? { method, source } : undefined,
    };
  });

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.'),
});

const accountType = z.enum(['researcher', 'participant']);

/** One sign-in for both account types (Stage 1). */
export const unifiedLoginSchema = loginSchema.extend({
  accountType: accountType.optional(),
  intent: accountType.optional(),
});

export const unifiedGoogleSchema = z.object({
  token: z.string().min(10, 'Missing Google token.'),
  accountType: accountType.optional(),
  intent: accountType.optional(),
  method: z.enum(METHODS).optional(),
  // A NEW participant account through Google needs the same country and agreement as the email form.
  country: z.string().trim().max(80).optional(),
  agree: z.boolean().optional(),
});

export const resendVerificationSchema = z.object({ email, accountType: accountType.optional() });

export const googleAuthSchema = z.object({ token: z.string().min(10, 'Missing Google token.') });

export const sendOtpSchema = z.object({ email });

export const verifyOtpSchema = z.object({
  email,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

export const resetPasswordSchema = z.object({
  email,
  token: z.string().min(10, 'This reset link is not valid.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  intent: z.enum(['researcher', 'participant']).optional(),
});

/** Profile answers are free-form strings keyed by question name (see PARTICIPANT_QUESTIONS in the frontend). */
export const completeProfileSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .refine((v) => Object.keys(v).length > 0, 'Answer the profile questions to continue.');

const tags = z.array(z.string().trim().min(1).max(80)).max(20);
export const completeResearcherProfileSchema = z.object({
  purposeHere: tags.default([]),
  researchType: tags.default([]),
  researchInterest: tags.default([]),
  firstName: z.string().trim().min(1, 'First name is required.').max(80),
  lastName: z.string().trim().min(1, 'Last name is required.').max(80),
  organization: z.string().trim().min(1, 'Organisation is required.').max(160),
  street: z.string().trim().min(1, 'Street is required.').max(200),
  address2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, 'City is required.').max(120),
  country: z.string().trim().min(1, 'Country is required.').max(80),
});

export const payoutSchema = z.object({
  method: z.enum(['bank_transfer', 'mobile_money', 'paypal']).default('bank_transfer'),
  bankName: z.string().trim().max(120).optional(),
  accountName: z.string().trim().min(2, 'Enter the account name.').max(120),
  accountNumber: z.string().trim().min(4, 'Enter the account number.').max(64),
});

// Kept for backwards compatibility with the original starter.
export const createParticipantSchema = registerParticipantSchema;

/* ---------- Stage 2: account setup ---------- */
export const ORG_TYPES = ['university', 'institute', 'company', 'nonprofit', 'government', 'independent'] as const;
/** Organisation types that can verify and get the academic fee. */
export const VERIFIABLE_ORG_TYPES: readonly string[] = ['university', 'institute', 'nonprofit', 'government'];
export const FIRST_METHODS = ['survey', 'interview', 'focus-group', 'product-test', 'ai-evaluation', 'not-sure'] as const;

export const profileSchema = z
  .object({
    organizationType: z.enum(ORG_TYPES, { message: 'Choose where you work.' }),
    organizationName: z.string().trim().max(160).optional().default(''),
    country: z.string().trim().min(2, "Choose the country you're based in.").max(80),
    role: z.string().trim().max(80).optional(),
    researchAreas: z.array(z.string().trim().min(1).max(60)).max(15).optional().default([]),
    firstMethod: z.enum(FIRST_METHODS).optional(),
    heardFrom: z.string().trim().max(80).optional(),
  })
  .refine((v) => v.organizationType === 'independent' || v.organizationName.length > 0, {
    message: "Enter your organisation's name.",
    path: ['organizationName'],
  });

export const workEmailSchema = z.object({ email });
export const workEmailCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.') });
export const staffLinkSchema = z.object({
  url: z
    .string()
    .trim()
    .url('Enter the full link, starting with https://')
    .refine((u) => /^https?:\/\//i.test(u), 'Enter the full link, starting with https://'),
});

/** Stage 3: the founding-lab card on the researcher home. */
export const foundingLabSchema = z.object({ action: z.enum(['apply', 'dismiss']) });
