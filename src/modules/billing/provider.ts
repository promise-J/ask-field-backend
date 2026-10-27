import crypto from 'crypto';
import AppError from '../../error-helpers/appError';
import { env } from '../../config/env';

/**
 * Card payments. With STRIPE_SECRET_KEY: Stripe PaymentIntents over its REST API (no SDK needed),
 * confirmed by the webhook. Without it, outside production: a test provider the app confirms itself.
 */
export type ProviderName = 'stripe' | 'test';

let warned = false;
/**
 * Stripe needs both keys: the secret one (server) and the publishable one (the card form in the browser).
 * In production without them, cards are off and researchers are offered an invoice. `npm run check-stripe` tests them.
 */
export function providerName(): ProviderName {
  if (env.STRIPE_SECRET_KEY && env.STRIPE_PUBLISHABLE_KEY) return 'stripe';
  if (env.STRIPE_SECRET_KEY || env.NODE_ENV === 'production') {
    if (!warned) {
      warned = true;
      console.error(`[payments] Card payments are off: ${env.STRIPE_SECRET_KEY ? 'STRIPE_PUBLISHABLE_KEY' : 'STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY'} missing. Run npm run check-stripe.`);
    }
    throw new AppError('Card payments aren’t set up yet. Choose invoice, or email hello@joinstudy.io.', 503, 'payments_unavailable');
  }
  return 'test';
}

/** Stripe's API. STRIPE_API_BASE only exists so tests can stand in for Stripe. */
const base = () => (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, '');

/** Amount in the currency's smallest unit (kobo, cents). */
const minor = (amount: number) => Math.round(amount * 100);

export async function stripe(path: string, form?: Record<string, string>) {
  const res = await fetch(`${base()}/v1/${path}`, {
    method: form ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
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

/**
 * Asks Stripe how a card payment went (the webhook is the main route; this covers a missed or unset webhook).
 * Returns null for test payments.
 */
export async function cardPaymentStatus(providerRef: string) {
  if (!providerRef.startsWith('pi_') || !env.STRIPE_SECRET_KEY) return null;
  const pi = await stripe(`payment_intents/${encodeURIComponent(providerRef)}?expand[]=latest_charge`);
  return { status: pi.status as string, last4: (pi.latest_charge?.payment_method_details?.card?.last4 as string | undefined) || undefined };
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
