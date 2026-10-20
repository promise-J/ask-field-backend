import crypto from 'crypto';
import { isValidObjectId, Types } from 'mongoose';
import AppError from '../../error-helpers/appError';
import { config, env } from '../../config/env';
import logger from '../../config/logger';
import { sendMail } from '../../utils/mailer';
import { ParticipantModel } from '../user/models/participant.model';
import { TransactionModel } from '../wallet/transaction.model';
import { WalletService } from '../wallet/wallet.service';
import { SurveyModel } from '../survey/survey.model';
import { normalisePhone } from '../verification/verification.service';
import { AIRTIME_MAX_USD, LOCAL_CURRENCY, METHODS, type PayoutMethod } from './options';
import { payoutProvider } from './provider';
import { PayoutLockModel, PayoutQuoteModel } from './quote.model';
import { closedRecently } from '../account/settings.service';

/**
 * Participant Stage 6: get paid (canvas 6.1–6.4).
 * One payout method per person, checked by the provider; cash out from the minimum with the local amount shown first;
 * the balance is reserved in one step; the provider sends it; failures come back to the balance.
 */

const HOLD_AFTER_CHANGE_MS = 48 * 3600e3;
const QUOTE_MS = 10 * 60e3;
const LOCK_MS = 60e3;
const round2 = (n: number) => Math.round(n * 100) / 100;
const wallet = new WalletService();
const site = () => env.FRONTEND_URL.replace(/\/$/, '');
const money = (n: number, cur: string) => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' }).format(n);
  } catch {
    return `${cur} ${n.toFixed(2)}`;
  }
};

async function me(participantId: string) {
  const p: any = await ParticipantModel.findById(participantId).select('+payout.accountHash');
  if (!p) throw new AppError('Account not found.', 404);
  return p;
}
const countryOf = (p: any) => p.country || p.profile?.countryOfResidence || 'Nigeria';

/** Names match when the account holds both their first and last name, in any order (middle names are fine). */
export function namesMatch(ours: string, theirs: string) {
  const tokens = (s: string) => String(s || '').toUpperCase().replace(/[^A-Z\s'-]/g, ' ').split(/[\s'-]+/).filter((t) => t.length > 1);
  const want = tokens(ours);
  const have = new Set(tokens(theirs));
  return want.length > 0 && want.every((t) => have.has(t));
}

const methodView = (p: any) =>
  p.payout?.method
    ? { method: p.payout.method, institution: p.payout.institution || '', last4: p.payout.last4, accountName: p.payout.accountName, savedAt: p.payout.savedAt }
    : null;

function cleanAccount(country: string, method: PayoutMethod, raw: string) {
  const v = String(raw || '').trim();
  if (method === 'paypal') {
    const email = v.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('Enter the email address of your PayPal account.', 400, 'bad_account');
    return { key: email, last4: email.split('@')[0].slice(-4) };
  }
  if (method === 'bank') {
    const digits = v.replace(/\D/g, '');
    if (country === 'Nigeria' ? digits.length !== 10 : digits.length < 6 || digits.length > 20) {
      throw new AppError(country === 'Nigeria' ? 'Nigerian account numbers have 10 digits.' : 'Check the account number.', 400, 'bad_account');
    }
    return { key: digits, last4: digits.slice(-4) };
  }
  const phone = normalisePhone(v, country);
  if (!phone) throw new AppError('Check the phone number.', 400, 'bad_account');
  return { key: phone, last4: phone.slice(-4) };
}

/** Canvas 6.2: the methods for their country, and what's saved. */
export async function payoutMethod(participantId: string) {
  const p = await me(participantId);
  const country = countryOf(p);
  return { country, currency: LOCAL_CURRENCY[country] || null, options: METHODS[country] || [], current: methodView(p), holdUntil: p.payoutHoldUntil && p.payoutHoldUntil > new Date() ? p.payoutHoldUntil : null };
}

/** Canvas 6.2: checks the account with the provider. The name must be theirs; one account per person. */
export async function savePayoutMethod(participantId: string, input: { method: PayoutMethod; institution?: string; account: string }) {
  const p = await me(participantId);
  const country = countryOf(p);
  const option = (METHODS[country] || []).find((o) => o.method === input.method);
  if (!option) throw new AppError(`That way of being paid isn’t available in ${country}.`, 400, 'method_unavailable');
  const institution = option.institutions.length === 1 ? option.institutions[0] : String(input.institution || '');
  if (option.institutionLabel && !option.institutions.includes(institution)) throw new AppError(`Choose your ${option.institutionLabel.toLowerCase()}.`, 400, 'institution_required');
  const { key, last4 } = cleanAccount(country, input.method, input.account);
  const accountHash = crypto.createHmac('sha256', config.phoneHashSecret).update(`payout|${country}|${input.method}|${institution}|${key}`).digest('hex');
  if (await ParticipantModel.exists({ _id: { $ne: p._id }, 'payout.accountHash': accountHash })) {
    throw new AppError('This account is already used for payouts by another joinStudy account. Each person can use their own account only. If it’s yours, contact us.', 409, 'account_taken');
  }
  if (await closedRecently('payout', accountHash)) {
    throw new AppError('This account was used by a joinStudy account closed in the last 12 months, so it can’t be used yet. If it’s yours, contact us.', 409, 'account_closed');
  }
  const ownName = `${p.firstName || ''} ${p.lastName || ''}`.trim();
  const found = await payoutProvider().resolve({ country, method: input.method, institution, account: key, ownerName: ownName });
  if (!namesMatch(ownName, found.accountName)) {
    throw new AppError(`The account name is ${found.accountName}, which doesn’t match your name (${ownName}). Payouts can only go to an account in your own name.`, 400, 'name_mismatch', { accountName: found.accountName });
  }
  const changing = !!p.payout?.method && p.payout.accountHash !== accountHash;
  p.set('payout', { method: input.method, institution, last4, accountName: found.accountName, providerRef: found.ref, accountHash, country, savedAt: new Date() });
  if (changing) p.payoutHoldUntil = new Date(Date.now() + HOLD_AFTER_CHANGE_MS);
  await p.save();
  if (changing) {
    await sendMail({
      to: p.email,
      subject: 'Your joinStudy payout method changed',
      text: `Your payouts now go to ${institution || option.label} ending ${last4}. For your safety, cash-outs are paused for 48 hours.\n\nIf you didn't make this change, reply to this email or contact hello@joinstudy.io straight away.`,
    });
  }
  return payoutMethod(participantId);
}

/** Canvas 6.1: the balance, where it goes, and the statement. */
export async function moneyView(participantId: string) {
  const p = await me(participantId);
  const s = await wallet.participantSummary(participantId);
  const owner = new Types.ObjectId(participantId);
  const lines: any[] = await TransactionModel.find({ ownerId: owner, $or: [{ kind: 'earning', status: { $in: ['available', 'paid'] } }, { kind: 'payout' }] }).sort({ createdAt: -1 }).limit(200);
  const titles = new Map(
    (await SurveyModel.find({ _id: { $in: lines.map((l) => l.surveyId).filter(Boolean) } }).select('plan.basics.title surveyName')).map((x: any) => [String(x._id), x.plan?.basics?.title || x.surveyName])
  );
  const country = countryOf(p);
  return {
    currency: s.currency,
    ready: s.available,
    waiting: s.pending,
    waitingCount: await TransactionModel.countDocuments({ ownerId: owner, kind: 'earning', status: 'pending' }),
    onWay: s.processing,
    minPayout: config.minPayoutAmount,
    localCurrency: LOCAL_CURRENCY[country] || null,
    method: methodView(p),
    holdUntil: p.payoutHoldUntil && p.payoutHoldUntil > new Date() ? p.payoutHoldUntil : null,
    airtimeMax: AIRTIME_MAX_USD,
    lines: lines.map((l) =>
      l.kind === 'earning'
        ? { id: String(l._id), kind: 'earning', title: titles.get(String(l.surveyId)) || 'Study', surveyId: l.surveyId ? String(l.surveyId) : null, amount: l.amount, currency: l.currency, at: l.updatedAt }
        : {
            id: String(l._id),
            kind: 'payout',
            title: `Cash out to ${l.payout?.institution || 'your account'} ••${l.payout?.last4 || l.payoutDetails?.accountNumberLast4 || ''}`,
            status: l.status === 'paid' ? 'sent' : l.status === 'failed' ? 'failed' : 'sending',
            amount: l.amount,
            currency: l.currency,
            localAmount: l.payout?.localAmount ?? null,
            localCurrency: l.payout?.localCurrency ?? null,
            reason: l.payout?.failReason || '',
            reference: l.payout?.reference || '',
            at: l.createdAt,
          }
    ),
  };
}

function cashOutBlock(p: any, view: { ready: number; onWay: number }, amount: number) {
  if (!p.payout?.method) return 'Add where to send your money first.';
  if (p.payoutHoldUntil && p.payoutHoldUntil > new Date()) return `Cash-outs are paused until ${p.payoutHoldUntil.toUTCString().slice(0, 22)} because your payout method changed.`;
  if (view.onWay > 0) return 'Your last cash-out is still on its way. You can cash out again once it arrives.';
  if (amount <= 0 || view.ready <= 0) return 'You have nothing ready to cash out yet.';
  if (amount > view.ready + 1e-9) return `That’s more than you have ready (${money(view.ready, env.DEFAULT_CURRENCY)}).`;
  if (amount < config.minPayoutAmount) return `You can cash out from ${money(config.minPayoutAmount, env.DEFAULT_CURRENCY)}.`;
  if (p.payout.method === 'airtime' && amount > AIRTIME_MAX_USD) return `Airtime is up to ${money(AIRTIME_MAX_USD, env.DEFAULT_CURRENCY)} at a time.`;
  return null;
}

/** Canvas 6.3: the exact local amount and rate, held for 10 minutes. */
export async function quote(participantId: string, input: { amount?: number }) {
  const p = await me(participantId);
  const s = await wallet.participantSummary(participantId);
  const amount = round2(input.amount ?? (p.payout?.method === 'airtime' ? Math.min(s.available, AIRTIME_MAX_USD) : s.available));
  const block = cashOutBlock(p, { ready: s.available, onWay: s.processing }, amount);
  if (block) throw new AppError(block, 400, 'cant_cash_out');
  const localCurrency = LOCAL_CURRENCY[countryOf(p)];
  const rate = p.payout.method === 'paypal' ? 1 : await payoutProvider().rate(localCurrency);
  const q = await PayoutQuoteModel.create({
    participantId: p._id,
    amount,
    currency: s.currency,
    rate,
    localAmount: round2(amount * rate),
    localCurrency: p.payout.method === 'paypal' ? s.currency : localCurrency,
    expiresAt: new Date(Date.now() + QUOTE_MS),
  });
  return {
    quoteId: String(q._id),
    amount,
    currency: s.currency,
    rate,
    localAmount: q.localAmount,
    localCurrency: q.localCurrency,
    fee: 0,
    expiresAt: q.expiresAt,
    to: methodView(p),
  };
}

/**
 * Canvas 6.3: confirm. The participant is locked for a moment while the balance is checked and the payout written,
 * so two cash-outs can never take the same money. Then the provider sends it.
 */
export async function cashOut(participantId: string, quoteId: string, now = new Date()) {
  if (!isValidObjectId(quoteId)) throw new AppError('Get a new amount first.', 400, 'bad_quote');
  await takeLock(participantId, now);
  let payout: any;
  try {
    const p = await me(participantId);
    const q: any = await PayoutQuoteModel.findOne({ _id: quoteId, participantId });
    if (!q || q.usedAt) throw new AppError('Get a new amount first.', 400, 'bad_quote');
    if (q.expiresAt <= now) throw new AppError('That rate has expired. Check the new amount and confirm again.', 409, 'quote_expired');
    const s = await wallet.participantSummary(participantId);
    const block = cashOutBlock(p, { ready: s.available, onWay: s.processing }, q.amount);
    if (block) throw new AppError(block, 400, 'cant_cash_out');
    const n = await TransactionModel.countDocuments({ kind: 'payout' });
    payout = await TransactionModel.create({
      ownerId: p._id,
      ownerType: 'participant',
      kind: 'payout',
      status: 'processing',
      amount: q.amount,
      currency: q.currency,
      description: 'Cash out',
      payout: {
        method: p.payout.method,
        institution: p.payout.institution,
        last4: p.payout.last4,
        accountName: p.payout.accountName,
        localAmount: q.localAmount,
        localCurrency: q.localCurrency,
        rate: q.rate,
        reference: `JS-PO-${String(n + 1).padStart(6, '0')}`,
        provider: payoutProvider().name,
      },
    });
    q.usedAt = now;
    await q.save();
  } finally {
    await PayoutLockModel.deleteOne({ _id: participantId });
  }
  const p = await me(participantId);
  try {
    const sent = await payoutProvider().send({ ref: p.payout.providerRef, amount: payout.payout.localAmount, currency: payout.payout.localCurrency, reference: payout.payout.reference });
    payout.set('payout.providerRef', sent.providerRef);
    await payout.save();
  } catch (err: any) {
    logger.error({ err, payout: String(payout._id) }, 'Payout failed to send');
    await failed(payout, err?.message || 'The payout partner couldn’t send it.');
  }
  return statusView(participantId, String(payout._id));
}

async function failed(t: any, reason: string) {
  t.status = 'failed';
  t.set('payout.failedAt', new Date());
  t.set('payout.failReason', reason);
  await t.save();
  const p: any = await ParticipantModel.findById(t.ownerId).select('email');
  await sendMail({
    to: p?.email,
    subject: 'Your cash-out didn’t go through',
    text: `Your cash-out of ${money(t.payout.localAmount, t.payout.localCurrency)} (${t.payout.reference}) was turned down: ${reason}\n\n${money(t.amount, t.currency)} is back in your joinStudy balance. Check your payout method, then cash out again: ${site()}/dashboard/participant/earnings`,
  });
}

/** Canvas 6.4: requested → sent → arrived, or returned. */
export async function statusView(participantId: string, id: string) {
  if (!isValidObjectId(id)) throw new AppError('Cash-out not found.', 404);
  const t: any = await TransactionModel.findOne({ _id: id, ownerId: participantId, kind: 'payout' });
  if (!t) throw new AppError('Cash-out not found.', 404);
  return {
    id: String(t._id),
    status: t.status === 'paid' ? 'sent' : t.status === 'failed' ? 'failed' : 'sending',
    amount: t.amount,
    currency: t.currency,
    localAmount: t.payout?.localAmount ?? null,
    localCurrency: t.payout?.localCurrency ?? null,
    rate: t.payout?.rate ?? null,
    to: { method: t.payout?.method, institution: t.payout?.institution, last4: t.payout?.last4 },
    reference: t.payout?.reference || '',
    requestedAt: t.createdAt,
    sentAt: t.payout?.sentAt || null,
    failedAt: t.payout?.failedAt || null,
    reason: t.payout?.failReason || '',
  };
}

export async function takeLock(participantId: string, now: Date) {
  for (let i = 0; i < 2; i++) {
    try {
      await PayoutLockModel.create({ _id: participantId, at: now });
      return;
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      // A lock left by a crash expires after a minute.
      await PayoutLockModel.deleteOne({ _id: participantId, at: { $lt: new Date(now.getTime() - LOCK_MS) } });
    }
  }
  throw new AppError('A cash-out is already being made. Give it a moment.', 409, 'busy');
}

/** Every few minutes: asks the provider how each cash-out is doing. */
export async function syncPayouts() {
  const list: any[] = await TransactionModel.find({ kind: 'payout', status: 'processing', 'payout.providerRef': { $exists: true } }).limit(200);
  let sent = 0;
  for (const t of list) {
    const r = await payoutProvider().status(t.payout.providerRef);
    if (r.state === 'sent') {
      const done = await TransactionModel.updateOne({ _id: t._id, status: 'processing' }, { $set: { status: 'paid', 'payout.sentAt': new Date() } });
      if (!done.modifiedCount) continue;
      sent++;
      const p: any = await ParticipantModel.findById(t.ownerId).select('email');
      await sendMail({ to: p?.email, subject: `${money(t.payout.localAmount, t.payout.localCurrency)} sent`, text: `Your cash-out (${t.payout.reference}) was sent to ${t.payout.institution || 'your account'} ending ${t.payout.last4}. If it doesn't show within a day, contact us with the reference.` });
    } else if (r.state === 'failed') {
      await failed(t, r.reason || 'It was turned down.');
    }
  }
  return { sent };
}

/** Download: every study paid and every cash-out. */
export async function statementCsv(participantId: string) {
  const v = await moneyView(participantId);
  const esc = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const rows = [['Date', 'What', 'Status', 'Amount', 'Currency', 'Local amount', 'Local currency', 'Reference'].join(',')];
  for (const l of v.lines as any[]) {
    rows.push([new Date(l.at).toISOString().slice(0, 10), esc(l.title), l.kind === 'earning' ? 'paid in' : l.status, (l.kind === 'payout' ? -l.amount : l.amount).toFixed(2), l.currency, l.localAmount ?? '', l.localCurrency ?? '', l.reference || ''].join(','));
  }
  return rows.join('\n') + '\n';
}
