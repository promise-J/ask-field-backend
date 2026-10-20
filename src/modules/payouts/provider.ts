import crypto from 'crypto';
import AppError from '../../error-helpers/appError';
import logger from '../../config/logger';
import { env } from '../../config/env';
import type { PayoutMethod } from './options';

/**
 * Participant Stage 6: the payout provider sends the money and holds the account details.
 * joinStudy keeps the provider's reference, the last digits and the account name it reports.
 *
 * Only a test provider exists until one is chosen (bank and mobile money: e.g. Flutterwave or Paystack;
 * airtime: e.g. Reloadly; PayPal Payouts). Like Stripe's test mode, it refuses to run in production.
 *
 * Test accounts: an account ending in 00 belongs to "CHIDI OKAFOR" (a name that won't match);
 * one ending in 99 resolves, but transfers to it are turned down ("the account is closed").
 */
export interface PayoutProvider {
  name: string;
  resolve(input: { country: string; method: PayoutMethod; institution: string; account: string; ownerName: string }): Promise<{ accountName: string; ref: string }>;
  rate(currency: string): Promise<number>;
  send(input: { ref: string; amount: number; currency: string; reference: string }): Promise<{ providerRef: string }>;
  status(providerRef: string): Promise<{ state: 'processing' | 'sent' | 'failed'; reason?: string }>;
}

const notInProduction = () => {
  if (env.NODE_ENV === 'production') throw new AppError('Cash-outs aren’t set up yet. Your balance is safe; please try again later.', 503, 'payouts_unavailable');
};

const TEST_RATES: Record<string, number> = { NGN: 1550, GHS: 15.5, KES: 129 };
// Stateless, so any server (or a script) can answer: the last two digits of the account travel in the references.
const tail2 = (ref: string) => ref.slice(-2);

export const testPayouts: PayoutProvider = {
  name: 'test',
  async resolve({ account, ownerName }) {
    notInProduction();
    const ref = `test_rcp_${crypto.randomUUID().slice(0, 8)}_${account.slice(-2)}`;
    return { accountName: account.endsWith('00') ? 'CHIDI OKAFOR' : ownerName.toUpperCase(), ref };
  },
  async rate(currency) {
    notInProduction();
    const r = TEST_RATES[currency];
    if (!r) throw new AppError(`We can’t pay out in ${currency} yet.`, 400, 'currency_unsupported');
    return r;
  },
  async send({ ref, amount, currency, reference }) {
    notInProduction();
    logger.info({ reference, amount, currency }, `💸 Payout ${reference}: ${currency} ${amount} (test provider, not sent)`);
    return { providerRef: `test_trf_${crypto.randomUUID().slice(0, 8)}_${tail2(ref)}` };
  },
  async status(providerRef) {
    if (!providerRef.startsWith('test_trf_')) return { state: 'failed', reason: 'The payout partner has no record of it.' };
    return tail2(providerRef) === '99' ? { state: 'failed', reason: 'The account is closed.' } : { state: 'sent' };
  },
};

export function payoutProvider(): PayoutProvider {
  return testPayouts; // the only one until a provider is chosen (env PAYOUT_PROVIDER)
}
