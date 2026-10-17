import { Types, isValidObjectId } from 'mongoose';
import AppError from '../../error-helpers/appError';
import { config, env } from '../../config/env';
import logger from '../../config/logger';
import { sendMail } from '../../utils/mailer';
import { SurveyModel } from '../survey/survey.model';
import { ResearcherModel } from '../user/models/researcher.model';
import { TransactionModel } from '../wallet/transaction.model';
import { planView } from '../survey/plan.service';
import { hourly } from '../survey/plan';
import { FundingModel } from './funding.model';
import { createCardPayment, providerName, refundCard } from './provider';

/**
 * Stage 5: fund and launch. Researchers pay the full cost of a study up front (card or invoice);
 * automatic checks run; a person on the team approves it or asks for changes; then it goes live.
 */

const round = (n: number) => Math.round(n * 100) / 100;
const BOOKING = ['interview', 'focus-group'];
const reviewInbox = () => env.REVIEW_INBOX || env.LEADS_INBOX;

async function owned(userId: string, id: string) {
  if (!isValidObjectId(id)) throw new AppError('Study not found.', 404);
  const s: any = await SurveyModel.findOne({ _id: id, userId });
  if (!s) throw new AppError('Study not found.', 404);
  return s;
}

/** Money paid in for a study so far (card, invoice and credit). */
export async function paidIn(surveyId: unknown) {
  const rows = await FundingModel.find({ surveyId, status: 'paid' }).select('amount creditUsed');
  return round(rows.reduce((t, f: any) => t + (f.amount || 0) + (f.creditUsed || 0), 0));
}

/** Credit the researcher can spend: money returned as credit, minus credit already used. */
export async function creditBalance(researcherId: string) {
  const owner = new Types.ObjectId(researcherId);
  const rows = await TransactionModel.aggregate([
    { $match: { ownerId: owner, kind: { $in: ['credit', 'credit-used'] }, status: { $in: ['available', 'paid'] } } },
    { $group: { _id: '$kind', total: { $sum: '$amount' } } },
  ]);
  const by = Object.fromEntries(rows.map((r: any) => [r._id, r.total]));
  return Math.max(0, round((by.credit || 0) - (by['credit-used'] || 0)));
}

async function nextNumber() {
  const year = new Date().getFullYear();
  const n = (await FundingModel.countDocuments({ number: { $regex: `^JS-${year}-` } })) + 1;
  return `JS-${year}-${String(n).padStart(4, '0')}`;
}

/** Everything the review, pay and status screens show. */
export async function launchView(userId: string, id: string) {
  const s = await owned(userId, id);
  const view = await planView(userId, id);
  const [fundings, inSoFar, credit] = await Promise.all([
    FundingModel.find({ surveyId: s._id, status: { $ne: 'cancelled' } }).sort({ createdAt: 1 }),
    paidIn(s._id),
    creditBalance(userId),
  ]);
  let cards: 'stripe' | 'test' | 'unavailable';
  try {
    cards = providerName();
  } catch {
    cards = 'unavailable';
  }
  return {
    ...view,
    launchStage: s.launchStage || 'none',
    review: { checks: s.review?.checks || [], note: s.review?.note || '', requestedAt: s.review?.requestedAt || null, decidedAt: s.review?.decidedAt || null },
    fundings: fundings.map((f) => f.toJSON()),
    paidIn: inSoFar,
    due: Math.max(0, round(view.figures.total - inSoFar)),
    credit,
    payments: { cards, publishableKey: cards === 'stripe' ? env.STRIPE_PUBLISHABLE_KEY ?? null : null, invoices: true },
    bookingNotReady: false, // Stage 6: booking is built, so interviews and focus groups can launch
    usesBooking: BOOKING.includes(view.method),
  };
}

type Receipt = { name: string; organization?: string; email: string; cc?: string; reference?: string; country: string };

/** Starts paying for a study. Returns what the browser needs to finish a card payment, or the invoice. */
export async function pay(userId: string, id: string, input: { method: 'card' | 'invoice'; useCredit?: boolean; receipt: Receipt; agree: boolean }) {
  const s = await owned(userId, id);
  if (s.status !== 'draft') throw new AppError('This study is already live.', 409, 'already_live');
  if (!['none', 'changes-needed', 'awaiting-payment'].includes(s.launchStage || 'none')) throw new AppError('We’re already checking this study.', 409, 'in_review');
  const owner: any = await ResearcherModel.findById(userId).select('isCompleteProfile email');
  if (!owner?.isCompleteProfile) throw new AppError('Finish setting up your account before you launch a study.', 403, 'setup_incomplete');
  const view = await launchView(userId, id);
  if (!view.ready) throw new AppError('Finish your plan first.', 400, 'plan_incomplete', { missing: view.missing });
  if (!input.agree) throw new AppError('Please confirm the study has the approvals it needs and follows the research terms.', 400, 'agree_required');

  // A new payment replaces any unpaid invoice for this study.
  await FundingModel.updateMany({ surveyId: s._id, status: 'pending' }, { $set: { status: 'cancelled' } });

  const due = view.due;
  if (due <= 0) {
    if (s.launchStage === 'changes-needed') return resubmit(userId, id);
    throw new AppError('This study is already paid for.', 409, 'already_paid');
  }
  const creditUsed = input.useCredit ? Math.min(view.credit, due) : 0;
  const rest = round(due - creditUsed);
  const f: any = await FundingModel.create({
    surveyId: s._id,
    researcherId: userId,
    method: rest === 0 ? 'credit' : input.method,
    amount: rest,
    creditUsed,
    currency: view.figures.currency,
    breakdown: { places: view.figures.places, perPerson: view.figures.perPerson, pay: view.figures.pay, feeRate: view.figures.feeRate, fee: view.figures.fee, total: view.figures.total },
    receipt: { ...input.receipt, email: input.receipt.email || owner.email },
  });

  if (rest === 0) {
    await markPaid(String(f._id));
    return { fundingId: String(f._id), status: 'paid' as const, method: 'credit' as const };
  }

  if (input.method === 'card') {
    const intent = await createCardPayment({
      amount: rest,
      currency: f.currency,
      fundingId: String(f._id),
      surveyId: String(s._id),
      email: f.receipt.email,
      description: `joinStudy: ${view.plan.basics?.title || s.surveyName}`,
    });
    f.provider = intent.provider;
    f.providerRef = intent.providerRef;
    await f.save();
    return { fundingId: String(f._id), status: 'pending' as const, method: 'card' as const, provider: intent.provider, clientSecret: intent.clientSecret, publishableKey: intent.publishableKey, amount: rest, currency: f.currency };
  }

  // Invoice: we email it; the study waits until the money arrives.
  f.provider = 'bank';
  f.number = await nextNumber();
  f.providerRef = `JS-${String(s._id).slice(-6).toUpperCase()}`;
  await f.save();
  s.launchStage = 'awaiting-payment';
  await s.save();
  const to = [f.receipt.email, f.receipt.cc].filter(Boolean).join(', ');
  await sendMail({
    to,
    subject: `Invoice ${f.number} for your joinStudy study`,
    text: [
      `Invoice ${f.number}`,
      `Study: ${view.plan.basics?.title || s.surveyName}`,
      `Amount due: ${f.currency} ${rest.toFixed(2)}`,
      `Reference to quote: ${f.providerRef}`,
      '',
      env.INVOICE_BANK_DETAILS ? `Pay to:\n${env.INVOICE_BANK_DETAILS.replace(/\\n/g, '\n')}` : 'We will send our bank details in a separate email.',
      '',
      'We start checking your study as soon as the payment arrives.',
    ].join('\n'),
  });
  await sendMail({ to: reviewInbox(), subject: `Invoice ${f.number} sent (${f.currency} ${rest.toFixed(2)})`, text: `Study ${s._id}. Mark paid with: npm run review-study -- paid ${f.number}` });
  return { fundingId: String(f._id), status: 'pending' as const, method: 'invoice' as const, number: f.number, reference: f.providerRef, amount: rest, currency: f.currency };
}

/** The researcher cancels an unpaid invoice to change the plan or pay by card instead. */
export async function cancelInvoice(userId: string, id: string) {
  const s = await owned(userId, id);
  await FundingModel.updateMany({ surveyId: s._id, status: 'pending' }, { $set: { status: 'cancelled' } });
  if (s.launchStage === 'awaiting-payment') {
    s.launchStage = (await paidIn(s._id)) > 0 ? 'changes-needed' : 'none';
    await s.save();
  }
  return launchView(userId, id);
}

/** Checks that need no person: they catch the common problems before our review. */
export async function autoChecks(s: any) {
  const plan = s.plan || {};
  const b = plan.basics || {};
  const setup = plan.setup || {};
  const minutes = Number(setup.minutes) || 0;
  const rate = hourly(Number(plan.pay?.perPerson) || 0, minutes);
  const link: string = s.surveyURL || '';
  const checks: { key: string; label: string; ok: boolean; note: string }[] = [];
  checks.push({ key: 'consent', label: 'Consent', ok: b.consent?.mode === 'own' || (b.consent?.text || '').length >= 20, note: b.consent?.mode === 'own' ? 'Collected in your study.' : 'On a joinStudy page.' });
  checks.push({ key: 'pay', label: 'Fair pay', ok: config.minHourlyPay == null || rate >= config.minHourlyPay, note: `${rate.toFixed(2)} an hour.` });
  checks.push({ key: 'description', label: 'Description', ok: (b.description || '').trim().length >= 20, note: (b.description || '').trim().length >= 20 ? 'Explains what people will do.' : 'Too short to tell people what they’ll do.' });
  let opens = true;
  let note = 'Opens.';
  if (env.NODE_ENV !== 'test' && /^https?:\/\//.test(link)) {
    try {
      const r = await fetch(link, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(6000) });
      opens = r.status < 400;
      note = opens ? 'Opens.' : `Returned ${r.status}.`;
    } catch {
      opens = false;
      note = 'We couldn’t open it from our servers. We’ll try it by hand.';
    }
  }
  checks.push({ key: 'link', label: 'Study link', ok: opens, note });
  return checks;
}

async function startReview(s: any, why: string) {
  s.launchStage = 'checking';
  s.review = { checks: await autoChecks(s), note: '', requestedAt: new Date(), decidedAt: undefined };
  await s.save();
  const failed = s.review.checks.filter((c: any) => !c.ok).map((c: any) => `${c.label}: ${c.note}`);
  await sendMail({
    to: reviewInbox(),
    subject: `Study to review: ${s.plan?.basics?.title || s.surveyName}`,
    text: `${why}\nStudy ${s._id}\n${failed.length ? `Automatic checks flagged:\n- ${failed.join('\n- ')}` : 'Automatic checks passed.'}\n\nApprove: npm run review-study -- approve ${s._id}\nAsk for changes: npm run review-study -- changes ${s._id} "what to change"`,
  });
}

/** Called by the webhook (Stripe), the test provider, the review script (invoices), or straight away for credit. Safe to call twice. */
export async function markPaid(fundingId: string, extra: { cardLast4?: string } = {}) {
  const f: any = await FundingModel.findById(fundingId);
  if (!f) throw new AppError('Payment not found.', 404);
  if (f.status === 'paid') return f;
  if (f.status !== 'pending') throw new AppError(`This payment is ${f.status}.`, 409);
  f.status = 'paid';
  f.paidAt = new Date();
  if (!f.number) f.number = await nextNumber();
  if (extra.cardLast4) f.cardLast4 = extra.cardLast4;
  await f.save();
  const base = { ownerId: f.researcherId, ownerType: 'researcher', status: 'paid', currency: f.currency, surveyId: f.surveyId };
  if (f.amount > 0) await TransactionModel.updateOne({ ledgerKey: `${f._id}:funding` }, { $setOnInsert: { ...base, kind: 'funding', amount: f.amount, description: `Payment ${f.number}` } }, { upsert: true });
  if (f.creditUsed > 0) await TransactionModel.updateOne({ ledgerKey: `${f._id}:credit-used` }, { $setOnInsert: { ...base, kind: 'credit-used', amount: f.creditUsed, description: `Credit used on ${f.number}` } }, { upsert: true });

  const s: any = await SurveyModel.findById(f.surveyId);
  if (f.purpose === 'add-places') {
    const { applyExtraPlaces } = await import('../run/live.service');
    await applyExtraPlaces(f.surveyId, f.extraPlaces || 0, f.extraSession);
  } else if (s && s.status === 'draft') await startReview(s, `Paid ${f.currency} ${(f.amount + f.creditUsed).toFixed(2)} (${f.method}).`);
  await sendMail({
    to: [f.receipt?.email, f.receipt?.cc].filter(Boolean).join(', '),
    subject: `Receipt ${f.number} from joinStudy`,
    text: `Thanks. We received ${f.currency} ${(f.amount + f.creditUsed).toFixed(2)} for "${s?.plan?.basics?.title || s?.surveyName}". ${f.purpose === 'add-places' ? `The ${f.extraPlaces} extra places are open now.` : 'We’re checking your study now and will email you when it’s live.'}`,
  });
  return f;
}

/** After "changes needed": send it back. If the changes raised the cost, the difference must be paid first. */
export async function resubmit(userId: string, id: string) {
  const s = await owned(userId, id);
  if (s.launchStage !== 'changes-needed') throw new AppError('There’s nothing to send back.', 409);
  const view = await launchView(userId, id);
  if (!view.ready) throw new AppError('Finish your plan first.', 400, 'plan_incomplete', { missing: view.missing });
  if (view.due > 0) throw new AppError(`Your changes add ${view.figures.currency} ${view.due.toFixed(2)}. Pay the difference to send it back.`, 402, 'top_up_needed', { due: view.due });
  await startReview(s, 'Sent back after changes.');
  return { fundingId: null, status: 'checking' as const, method: null };
}

// ---------------------------------------------------------------- the team's side (review-study script)

async function forReview(surveyId: string) {
  if (!isValidObjectId(surveyId)) throw new AppError('Study not found.', 404);
  const s: any = await SurveyModel.findById(surveyId);
  if (!s) throw new AppError('Study not found.', 404);
  const r: any = await ResearcherModel.findById(s.userId).select('email firstName');
  return { s, r };
}

export async function approve(surveyId: string) {
  const { s, r } = await forReview(surveyId);
  if (s.launchStage !== 'checking') throw new AppError(`This study is ${s.launchStage === 'none' ? s.status : s.launchStage}, not waiting for review.`, 409);
  s.status = 'published';
  s.publishedAt = new Date();
  s.launchStage = 'none';
  s.review.decidedAt = new Date();
  s.markModified('review');
  await s.save();
  await sendMail({ to: r?.email, subject: 'Your study is live', text: `Hi ${r?.firstName || ''}, "${s.plan?.basics?.title || s.surveyName}" is live. Matching participants can see it now.` });
  return s;
}

export async function requestChanges(surveyId: string, note: string) {
  if (!note?.trim()) throw new AppError('Say what needs to change.', 400);
  const { s, r } = await forReview(surveyId);
  if (s.launchStage !== 'checking') throw new AppError('This study isn’t waiting for review.', 409);
  s.launchStage = 'changes-needed';
  s.review.note = note.trim();
  s.review.decidedAt = new Date();
  s.markModified('review');
  await s.save();
  await sendMail({ to: r?.email, subject: 'One thing to change before your study goes live', text: `${note.trim()}\n\nFix it in your plan, then send it back. Your payment stays with the study.` });
  return s;
}

/** We can't run this study: refund everything paid in. Cards are refunded automatically; invoices by the team. */
export async function reject(surveyId: string, note: string) {
  const { s, r } = await forReview(surveyId);
  if (!['checking', 'changes-needed', 'awaiting-payment'].includes(s.launchStage)) throw new AppError('This study isn’t in review.', 409);
  const fundings: any[] = await FundingModel.find({ surveyId: s._id, status: { $in: ['paid', 'pending'] } });
  const manual: string[] = [];
  for (const f of fundings) {
    if (f.status === 'pending') { f.status = 'cancelled'; await f.save(); continue; }
    if (f.provider === 'stripe' || f.provider === 'test') await refundCard(f.providerRef, f.amount);
    else if (f.amount > 0) manual.push(`${f.number}: ${f.currency} ${f.amount.toFixed(2)} by bank transfer`);
    if (f.creditUsed > 0) {
      await TransactionModel.updateOne({ ledgerKey: `${f._id}:credit-return` }, { $setOnInsert: { ownerId: f.researcherId, ownerType: 'researcher', kind: 'credit', status: 'available', amount: f.creditUsed, currency: f.currency, surveyId: f.surveyId, description: 'Credit returned' } }, { upsert: true });
    }
    f.status = 'refunded';
    await f.save();
    await TransactionModel.updateOne({ ledgerKey: `${f._id}:funding` }, { $set: { status: 'refunded' } });
  }
  s.launchStage = 'rejected';
  s.review = { ...(s.review?.toObject?.() ?? s.review ?? {}), note: note?.trim() || '', decidedAt: new Date() };
  s.markModified('review');
  await s.save();
  if (manual.length) await sendMail({ to: reviewInbox(), subject: 'Refunds to send by bank', text: manual.join('\n') });
  await sendMail({ to: r?.email, subject: 'We can’t run your study', text: `${note?.trim() || ''}\n\nEverything you paid is being refunded within 14 days.` });
  logger.info({ surveyId }, 'study rejected and refunded');
  return s;
}

export async function markInvoicePaid(number: string) {
  const f: any = await FundingModel.findOne({ number, status: 'pending' });
  if (!f) throw new AppError('No unpaid invoice with that number.', 404);
  return markPaid(String(f._id));
}

export async function reviewQueue() {
  return SurveyModel.find({ launchStage: { $in: ['checking', 'awaiting-payment'] } }).select('surveyName launchStage review.requestedAt userId').sort({ 'review.requestedAt': 1 });
}

/** A printable receipt or invoice (HTML; the browser saves it as PDF). */
export async function fundingDocument(userId: string, fundingId: string) {
  if (!isValidObjectId(fundingId)) throw new AppError('Not found.', 404);
  const f: any = await FundingModel.findOne({ _id: fundingId, researcherId: userId });
  if (!f) throw new AppError('Not found.', 404);
  const s: any = await SurveyModel.findById(f.surveyId).select('surveyName plan.basics.title');
  const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const kind = f.status === 'paid' ? 'Receipt' : 'Invoice';
  const b = f.breakdown || {};
  const money = (n: number) => `${f.currency} ${Number(n || 0).toFixed(2)}`;
  const rows = [
    [`${b.places} participants × ${money(b.perPerson)}`, money(b.pay)],
    [`joinStudy fee (${Math.round((b.feeRate || 0) * 100)}%, charged only on approved work)`, money(b.fee)],
    ...(f.creditUsed ? [['Credit used', `−${money(f.creditUsed)}`]] : []),
  ];
  const bank = kind === 'Invoice' && env.INVOICE_BANK_DETAILS ? `<h2>Pay to</h2><p>${esc(env.INVOICE_BANK_DETAILS).replace(/\\n/g, '<br>')}</p><p>Reference: <b>${esc(f.providerRef)}</b></p>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${kind} ${esc(f.number || '')}</title>
<style>body{font-family:system-ui,sans-serif;color:#120e22;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.5}table{width:100%;border-collapse:collapse}td{padding:8px 0;border-bottom:1px solid #ebe9f2}td:last-child{text-align:right}.tot td{font-weight:700;border:0}h1{margin:0 0 4px}small{color:#646080}</style></head><body>
<h1>${kind}${f.number ? ` ${esc(f.number)}` : ''}</h1><small>joinStudy · ${new Date(f.paidAt || f.createdAt).toDateString()}</small>
<p><b>${esc(f.receipt?.name)}</b><br>${esc(f.receipt?.organization)}<br>${esc(f.receipt?.country)}${f.receipt?.reference ? `<br>Grant or PO reference: ${esc(f.receipt.reference)}` : ''}</p>
<p>Study: ${esc(s?.plan?.basics?.title || s?.surveyName)}</p>
<table>${rows.map(([a, c]) => `<tr><td>${esc(a)}</td><td>${esc(c)}</td></tr>`).join('')}<tr class="tot"><td>${kind === 'Receipt' ? 'Paid' : 'Due'}${f.cardLast4 ? ` (card ending ${esc(f.cardLast4)})` : ''}</td><td>${money(f.amount)}</td></tr></table>
${bank}<p><small>Unused money comes back when the study closes. Questions: hello@joinstudy.io</small></p></body></html>`;
}

/** Stage 6: more places on a live study. Paid like a launch; the places are added once the money is in. */
export async function addPlaces(userId: string, id: string, input: { extra?: number; session?: string; method: 'card' | 'invoice'; useCredit?: boolean; receipt?: Receipt }) {
  const s = await owned(userId, id);
  if (s.status !== 'published') throw new AppError('Only a live study can get more places.', 409);
  let extra = Math.floor(Number(input.extra) || 0);
  let session: string | undefined;
  // Focus groups grow by a whole session: the group size is what's paid for.
  if ((s.method || 'survey') === 'focus-group') {
    if (!input.session) throw new AppError('For focus groups, add a session instead.', 400, 'add_session');
    const at = new Date(input.session);
    if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 12 * 3600e3) throw new AppError('Choose a time at least 12 hours from now.', 400);
    if ((s.plan?.setup?.sessions || []).some((x: string) => new Date(x).getTime() === at.getTime())) throw new AppError('You already have a session at that time.', 409);
    session = at.toISOString();
    extra = Number(s.plan?.setup?.perGroup) || 0;
  }
  if (extra < 1 || extra > 10000) throw new AppError('Add between 1 and 10,000 places.', 400);
  const view = await planView(userId, id);
  const due = round(extra * view.figures.perPerson * (1 + view.figures.feeRate));
  const credit = input.useCredit ? Math.min(await creditBalance(userId), due) : 0;
  const rest = round(due - credit);
  const last: any = await FundingModel.findOne({ surveyId: s._id, status: 'paid' }).sort({ createdAt: -1 });
  const f: any = await FundingModel.create({
    surveyId: s._id,
    researcherId: userId,
    purpose: 'add-places',
    extraPlaces: extra,
    extraSession: session,
    method: rest === 0 ? 'credit' : input.method,
    amount: rest,
    creditUsed: credit,
    currency: view.figures.currency,
    breakdown: { places: extra, perPerson: view.figures.perPerson, pay: round(extra * view.figures.perPerson), feeRate: view.figures.feeRate, fee: round(extra * view.figures.perPerson * view.figures.feeRate), total: due },
    receipt: input.receipt ?? last?.receipt ?? {},
  });
  if (rest === 0) {
    await markPaid(String(f._id));
    return { fundingId: String(f._id), status: 'paid' as const, method: 'credit' as const, extra };
  }
  if (input.method === 'card') {
    const intent = await createCardPayment({ amount: rest, currency: f.currency, fundingId: String(f._id), surveyId: String(s._id), email: f.receipt?.email, description: `joinStudy: ${extra} more places` });
    f.provider = intent.provider;
    f.providerRef = intent.providerRef;
    await f.save();
    return { fundingId: String(f._id), status: 'pending' as const, method: 'card' as const, provider: intent.provider, clientSecret: intent.clientSecret, publishableKey: intent.publishableKey, amount: rest, currency: f.currency, extra };
  }
  f.provider = 'bank';
  f.number = await nextNumber();
  f.providerRef = `JS-${String(s._id).slice(-6).toUpperCase()}`;
  await f.save();
  await sendMail({ to: [f.receipt?.email, f.receipt?.cc].filter(Boolean).join(', '), subject: `Invoice ${f.number}: ${extra} more places`, text: `Amount due: ${f.currency} ${rest.toFixed(2)}\nReference to quote: ${f.providerRef}\n${env.INVOICE_BANK_DETAILS ? `Pay to:\n${env.INVOICE_BANK_DETAILS.replace(/\\n/g, '\n')}` : 'We will send our bank details in a separate email.'}\nThe places are added when the payment arrives.` });
  return { fundingId: String(f._id), status: 'pending' as const, method: 'invoice' as const, number: f.number, reference: f.providerRef, amount: rest, currency: f.currency, extra };
}
