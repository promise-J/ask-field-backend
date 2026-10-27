import 'dotenv/config';
import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes'].includes(v.toLowerCase())));

const envSchema = z.object({
  PORT: z.string().default('5000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGO_URI: z.string(),
  JWT_SECRET: z.string(),
  JWT_REFRESH_SECRET: z.string().optional(),
  ACCESS_TOKEN_TTL: z.string().default('1h'),
  REFRESH_TOKEN_TTL: z.string().default('28d'),
  BREVO_API_KEY: z.string(),
  APP_NAME: z.string(),
  // Alpha feedback: sign people out after this many minutes without activity (both token lifetimes are capped at it,
  // and renewing only works within it). 0 turns it off, so REFRESH_TOKEN_TTL applies again.
  SESSION_IDLE_MINUTES: z.string().default('20'),
  REDIS_URL: z.string().optional(),

  // Where the React app lives. Used to build links in emails.
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  // Comma-separated list of allowed browser origins. Empty = allow all (development only).
  CORS_ORIGINS: z.string().optional(),

  // Email (any SMTP provider). When SMTP_HOST is empty, emails are written to the log instead.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().default('587'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('joinStudy <hello@joinstudy.io>'),
  REQUIRE_EMAIL_VERIFICATION: bool(true),
  // Where founding-lab, request-a-country and AI-pilot form submissions are emailed.
  LEADS_INBOX: z.string().default('hello@joinstudy.io'),

  // Firebase Admin, used to verify "Continue with Google" sign-ins from the frontend.
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),

  // Business rules. Placeholders: set your real policy.
  PLATFORM_FEE_RATE: z.string().default('0.22'),
  // Fee for verified universities, research institutes, non-profits and government (placeholder until decided).
  ACADEMIC_FEE_RATE: z.string().default('0.18'),
  // Extra academic email domains, comma-separated (e.g. carleton.ca,uottawa.ca). See utils/academic.ts.
  ACADEMIC_DOMAINS: z.string().optional(),
  // Smallest cash-out, in DEFAULT_CURRENCY.
  MIN_PAYOUT_AMOUNT: z.string().default('5'),
  // Hourly pay, in DEFAULT_CURRENCY. Below MIN_HOURLY_PAY a study can't launch (0 = no floor).
  // Below RECOMMENDED_HOURLY_PAY researchers see a "better pay fills faster" warning, and the estimate starts there.
  // Unset, they default to 4 and 8 when DEFAULT_CURRENCY is USD (the amounts only make sense in dollars).
  MIN_HOURLY_PAY: z.string().optional(),
  RECOMMENDED_HOURLY_PAY: z.string().optional(),
  // Stage 5 payments. With STRIPE_SECRET_KEY set, cards go through Stripe; without it (outside production) a test provider stands in.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // joinStudy's company bank details, printed on invoices. Use \n for new lines.
  INVOICE_BANK_DETAILS: z.string().optional(),
  // Where "a study is waiting for review" emails go.
  REVIEW_INBOX: z.string().optional(),
  // Participant Stage 7: the Help contact form, and reports about studies (both default to LEADS_INBOX).
  SUPPORT_INBOX: z.string().optional(),
  TRUST_INBOX: z.string().optional(),
  // Participant Stage 3: studies are priced and paid in US dollars. Participants convert at cash-out (Stage 6).
  DEFAULT_CURRENCY: z.string().default('USD'),

  // Participant Stage 1: where people can sign up to take studies, comma-separated. Anyone else joins a waitlist.
  PARTICIPANT_COUNTRIES: z.string().default('Nigeria,Ghana,Kenya'),
  // Cloudflare Turnstile (a free bot check on sign-up). Unset = skipped.
  TURNSTILE_SECRET: z.string().optional(),
  // One-time verification before a participant's first study: a WhatsApp/SMS code, then a selfie.
  // Set to false to let unverified participants take studies (e.g. while providers are being chosen).
  REQUIRE_PARTICIPANT_VERIFICATION: bool(true),
  // Who sends the WhatsApp/SMS code. "test" writes codes to the log (outside production only).
  // Real providers (Termii, Africa's Talking) plug in at src/modules/verification/providers.ts once chosen.
  PHONE_PROVIDER: z.enum(['test']).default('test'),
  // Who checks the selfie (liveness + one face per account). "test" lets you choose the result (outside production only).
  SELFIE_PROVIDER: z.enum(['test']).default('test'),
  // Secret mixed into phone-number hashes so a leaked database can't be reversed. Defaults to one derived from JWT_SECRET.
  PHONE_HASH_SECRET: z.string().optional(),
  // Participant Stage 2: "Connect LinkedIn" (optional). A LinkedIn app with "Sign In with LinkedIn using OpenID Connect".
  // Unset = test mode outside production (connects without visiting LinkedIn); refused in production.
  // Participant Stage 6: who sends cash-outs. "test" stands in outside production until a provider is chosen.
  PAYOUT_PROVIDER: z.enum(['test']).default('test'),
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
});

export const env = envSchema.parse(process.env);

/** A pay setting: the set value (0 = none), or the US-dollar default when unset and the currency is USD. */
export function hourlyPay(raw: string | undefined, currency: string, usdDefault: number) {
  if (raw != null && raw.trim() !== '') return Number(raw) > 0 ? Number(raw) : null;
  return currency.toUpperCase() === 'USD' ? usdDefault : null;
}

export const config = {
  refreshSecret: env.JWT_REFRESH_SECRET || `${env.JWT_SECRET}.refresh`,
  platformFeeRate: Number(env.PLATFORM_FEE_RATE),
  academicFeeRate: Number(env.ACADEMIC_FEE_RATE),
  extraAcademicDomains: (env.ACADEMIC_DOMAINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  minPayoutAmount: Number(env.MIN_PAYOUT_AMOUNT),
  minHourlyPay: hourlyPay(env.MIN_HOURLY_PAY, env.DEFAULT_CURRENCY, 4),
  recommendedHourlyPay: hourlyPay(env.RECOMMENDED_HOURLY_PAY, env.DEFAULT_CURRENCY, 8),
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  participantCountries: env.PARTICIPANT_COUNTRIES.split(',').map((s) => s.trim()).filter(Boolean),
  phoneHashSecret: env.PHONE_HASH_SECRET || `${env.JWT_SECRET}.phone`,
  idleMinutes: Math.max(0, Number(env.SESSION_IDLE_MINUTES) || 0),
};
