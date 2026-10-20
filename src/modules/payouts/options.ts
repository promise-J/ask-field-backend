/**
 * Participant Stage 6 (canvas 6.2): how people in each country can be paid.
 * Bank and network lists are the common ones; the payout provider's own list replaces them once one is chosen.
 */
export type PayoutMethod = 'bank' | 'mobile-money' | 'airtime' | 'paypal';
export interface MethodOption {
  method: PayoutMethod;
  label: string;
  note: string;
  /** What to choose (bank or network) and what to type. */
  institutionLabel: string | null;
  institutions: string[];
  accountLabel: string;
  accountHint: string;
}

export const LOCAL_CURRENCY: Record<string, string> = { Nigeria: 'NGN', Ghana: 'GHS', Kenya: 'KES' };
export const AIRTIME_MAX_USD = 10;

const NG_BANKS = ['Access Bank', 'Ecobank', 'Fidelity Bank', 'First Bank', 'FCMB', 'GTBank', 'Keystone Bank', 'Polaris Bank', 'Stanbic IBTC', 'Sterling Bank', 'UBA', 'Union Bank', 'Wema Bank', 'Zenith Bank'];
const GH_BANKS = ['Absa Ghana', 'Access Bank Ghana', 'CalBank', 'Ecobank Ghana', 'Fidelity Bank Ghana', 'GCB Bank', 'Stanbic Bank Ghana', 'Standard Chartered Ghana', 'Zenith Bank Ghana'];
const KE_BANKS = ['Absa Kenya', 'Co-operative Bank', 'Equity Bank', 'Family Bank', 'I&M Bank', 'KCB Bank', 'NCBA', 'Stanbic Kenya', 'Standard Chartered Kenya'];

const bank = (institutions: string[], accountLabel: string, accountHint: string, note: string): MethodOption => ({
  method: 'bank', label: 'Bank account', note, institutionLabel: 'Bank', institutions, accountLabel, accountHint,
});
const airtime = (networks: string[]): MethodOption => ({
  method: 'airtime', label: 'Airtime', note: `${networks.join(', ')}. Up to $${AIRTIME_MAX_USD} at a time.`, institutionLabel: 'Network', institutions: networks, accountLabel: 'Phone number', accountHint: '',
});
const paypal = (note: string): MethodOption => ({
  method: 'paypal', label: 'PayPal', note, institutionLabel: null, institutions: [], accountLabel: 'PayPal email', accountHint: 'you@example.com',
});

export const METHODS: Record<string, MethodOption[]> = {
  Nigeria: [
    bank(NG_BANKS, 'Account number (10 digits)', '0123456789', 'Any Nigerian bank. Usually arrives in minutes.'),
    { method: 'mobile-money', label: 'Mobile money wallet', note: 'OPay, PalmPay, Moniepoint or Paga.', institutionLabel: 'Wallet', institutions: ['OPay', 'PalmPay', 'Moniepoint', 'Paga'], accountLabel: 'Wallet number', accountHint: '0803 555 0142' },
    airtime(['MTN', 'Airtel', 'Glo', '9mobile']),
    paypal('Through Paga. You withdraw to naira from there.'),
  ],
  Ghana: [
    { method: 'mobile-money', label: 'Mobile money', note: 'MTN MoMo, Telecel Cash or AT Money. Usually arrives in minutes.', institutionLabel: 'Network', institutions: ['MTN MoMo', 'Telecel Cash', 'AT Money'], accountLabel: 'Mobile money number', accountHint: '024 555 0142' },
    bank(GH_BANKS, 'Account number', '', 'Any Ghanaian bank.'),
    airtime(['MTN', 'Telecel', 'AT']),
  ],
  Kenya: [
    { method: 'mobile-money', label: 'M-Pesa', note: 'Usually arrives in minutes.', institutionLabel: null, institutions: ['M-Pesa'], accountLabel: 'M-Pesa number', accountHint: '0712 555 142' },
    bank(KE_BANKS, 'Account number', '', 'Any Kenyan bank.'),
    airtime(['Safaricom', 'Airtel']),
    paypal('You can withdraw to M-Pesa from there.'),
  ],
};
