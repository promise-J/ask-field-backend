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
  REDIS_URL: z.string().optional(),

  // Brevo
  BREVO_API_KEY: z.string(),
  APP_NAME: z.string(),


  // Where the React app lives. Used to build links in emails.
  FRONTEND_URL: z.string().default('https://joinstudy.io'),
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
  MIN_PAYOUT_AMOUNT: z.string().default('5000'),
  // Lowest hourly pay the cost estimate suggests. Unset means no floor is shown (decision pending).
  MIN_HOURLY_PAY: z.string().optional(),
  // Stage 5 payments. With STRIPE_SECRET_KEY set, cards go through Stripe; without it (outside production) a test provider stands in.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // joinStudy's company bank details, printed on invoices. Use \n for new lines.
  INVOICE_BANK_DETAILS: z.string().optional(),
  // Where "a study is waiting for review" emails go.
  REVIEW_INBOX: z.string().optional(),
  DEFAULT_CURRENCY: z.string().default('USD'),
  //end

  // Participant Stage 7: the Help contact form, and reports about studies (both default to LEADS_INBOX).
  SUPPORT_INBOX: z.string().optional(),
  TRUST_INBOX: z.string().optional(),
  // Participant Stage 3: studies are priced and paid in US dollars. Participants convert at cash-out (Stage 6).

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

export const config = {
  refreshSecret: env.JWT_REFRESH_SECRET || `${env.JWT_SECRET}.refresh`,
  platformFeeRate: Number(env.PLATFORM_FEE_RATE),
  academicFeeRate: Number(env.ACADEMIC_FEE_RATE),
  extraAcademicDomains: (env.ACADEMIC_DOMAINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  minPayoutAmount: Number(env.MIN_PAYOUT_AMOUNT),
  minHourlyPay: env.MIN_HOURLY_PAY ? Number(env.MIN_HOURLY_PAY) : null,
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  participantCountries: env.PARTICIPANT_COUNTRIES.split(',').map((s) => s.trim()).filter(Boolean),
  phoneHashSecret: env.PHONE_HASH_SECRET || `${env.JWT_SECRET}.phone`,
};
