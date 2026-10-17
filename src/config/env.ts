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
  DEFAULT_CURRENCY: z.string().default('NGN')
});

export const env = envSchema.parse(process.env);

export const config = {
  refreshSecret: env.JWT_REFRESH_SECRET || `${env.JWT_SECRET}.refresh`,
  platformFeeRate: Number(env.PLATFORM_FEE_RATE),
  academicFeeRate: Number(env.ACADEMIC_FEE_RATE),
  extraAcademicDomains: (env.ACADEMIC_DOMAINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  minPayoutAmount: Number(env.MIN_PAYOUT_AMOUNT),
  minHourlyPay: env.MIN_HOURLY_PAY ? Number(env.MIN_HOURLY_PAY) : null,
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
};
