import crypto from 'crypto';
import AppError from '../../error-helpers/appError';
import { env } from '../../config/env';

/**
 * Card payments. With STRIPE_SECRET_KEY: Stripe PaymentIntents over its REST API (no SDK needed),
 * confirmed by the webhook. Without it, outside production: a test provider the app confirms itself.
 */
export type ProviderName = 'stripe' | 'test';

export function providerName(): ProviderName {
  if (env.STRIPE_SECRET_KEY) return 'stripe';
  if (env.NODE_ENV === 'production') throw new AppError('Card payments aren’t set up yet. Choose invoice, or email hello@joinstudy.io.', 503, 'payments_unavailable');
  return 'test';
}

/** Amount in the currency's smallest unit (kobo, cents). */
const minor = (amount: number) => Math.round(amount * 100);

async function stripe(path: string, form: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const body: any = await res.json();
  if (!res.ok) throw new AppError(body?.error?.message || 'The card payment couldn’t be started. Try again.', 502, 'provider_error');
  return body;
}

export async function createCardPayment(input: { amount: number; currency: string; fundingId: string; surveyId: string; email: string; description: string }) {
  const name = providerName();
  if (name === 'test') return { provider: name, providerRef: `test_${input.fundingId}`, clientSecret: `test_secret_${input.fundingId}`, publishableKey: null as string | null };
  const pi = await stripe('payment_intents', {
    amount: String(minor(input.amount)),
    currency: input.currency.toLowerCase(),
    'automatic_payment_methods[enabled]': 'true',
    receipt_email: input.email,
    description: input.description,
    'metadata[fundingId]': input.fundingId,
    'metadata[surveyId]': input.surveyId,
  });
  return { provider: name, providerRef: pi.id as string, clientSecret: pi.client_secret as string, publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null };
}

export async function refundCard(providerRef: string, amount: number) {
  if (!providerRef.startsWith('pi_')) return { id: `test_refund_${Date.now()}` };
  return stripe('refunds', { payment_intent: providerRef, amount: String(minor(amount)) });
}

/** Checks a Stripe webhook signature (t=…,v1=…) against the raw body. */
export function verifyStripeSignature(raw: Buffer, header: string | undefined, secret: string, toleranceSec = 300) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw.toString('utf8')}`).digest('hex');
  const given = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  return given.some((g) => g.length === expected.length && crypto.timingSafeEqual(Buffer.from(g), Buffer.from(expected)));
}
