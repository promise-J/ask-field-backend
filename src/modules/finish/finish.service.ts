import { isValidObjectId, Types } from 'mongoose';
import AppError from '../../error-helpers/appError';
import { env } from '../../config/env';
import { logger } from '../../config';
import { sendMail } from '../../utils/mailer';
import { SurveyActionModel, SurveyModel } from '../survey/survey.model';
import { placesAndMinutes } from '../survey/plan';
import { TransactionModel } from '../wallet/transaction.model';
import { FundingModel } from '../billing/funding.model';
import { paidIn } from '../billing/launch.service';
import { refundCard } from '../billing/provider';
import { BookingModel } from '../run/booking.model';
import { CLOSE_GRACE_MS } from '../run/live.service';
import { cancelFutureBookings } from '../run/booking.service';
import { ResearcherModel } from '../user/models/researcher.model';
import { feeRateFor } from '../user/services/setup.service';
import { AUTO_APPROVE_DAYS, autoApproveAt, flagsFor, REASONS } from '../review/review.service';
import { studyContact } from '../team/contact';

/**
 * Stage 8: finish a study. It closes (early, when full, or on its date), the last work is reviewed, then the
 * unused money goes back (credit, or to the card) and the final statement is ready. Results export any time.
 */

const DAY = 864e5;
const round = (n: number) => Math.round(n * 100) / 100;
const titleOf = (s: any) => s?.plan?.basics?.title || s?.surveyName || 'your study';
const methodOf = (s: any) => s?.method || 'survey';
const appUrl = (path: string) => `${env.FRONTEND_URL.replace(/\/$/, '')}${path}`;
const money = (n: number, cur: string) => `${cur} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function owned(userId: string, id: string) {
  if (!isValidObjectId(id)) throw new AppError('Study not found.', 404);
  const s: any = await SurveyModel.findOne({ _id: id, userId });
  if (!s) throw new AppError('Study not found.', 404);
  return s;
}

/** What participants were paid and what the fee was, from the researcher's charges for this study. */
async function spentOn(s: any) {
  const charges: any[] = await TransactionModel.find({ surveyId: s._id, kind: 'charge', status: 'paid' }).select('amount fee');
  const total = round(charges.reduce((t, c) => t + c.amount, 0));
  const fees = round(charges.reduce((t, c) => t + (c.fee || 0), 0));
  return { total, fees, participants: round(total - fees), approved: charges.length };
}

/** What still stands between a closed study and settling its money. */
async function blockers(s: any, now = new Date()) {
  const [waiting, inProgress, unmarked]: any[] = await Promise.all([
    SurveyActionModel.find({ surveyId: s._id, status: 'submitted' }).select('submittedAt'),
    SurveyActionModel.countDocuments({ surveyId: s._id, status: 'in-progress' }),
    BookingModel.find({ surveyId: s._id, status: 'booked' }).select('end'),
  ]);
  const graceEnds = s.closedAt ? new Date(new Date(s.closedAt).getTime() + CLOSE_GRACE_MS) : now;
  const stillFinishing = graceEnds > now ? inProgress : 0;
  const dates = [graceEnds, ...waiting.map((a: any) => autoApproveAt(a.submittedAt)), ...unmarked.map((b: any) => autoApproveAt(b.end))];
  return {
    toReview: waiting.length,
    stillFinishing,
    graceEnds,
    unmarked: unmarked.length,
    settlesBy: new Date(Math.max(...dates.map((d) => d.getTime()))),
    clear: waiting.length === 0 && stillFinishing === 0 && unmarked.length === 0,
  };
}

async function cardFundings(s: any) {
  return (await FundingModel.find({ surveyId: s._id, status: 'paid', provider: { $in: ['stripe', 'test'] }, amount: { $gt: 0 } }).sort({ paidAt: -1 })) as any[];
}

export async function finishView(userId: string, id: string, now = new Date()) {
  let s = await owned(userId, id);
  if (s.status === 'closed' && !s.settlement) {
    await settle(s, now); // settles as soon as nothing is left to decide
    s = await owned(userId, id);
  }
  const cur = s.currency || env.DEFAULT_CURRENCY;
  const [inSoFar, spent, b, cards, actions]: any[] = await Promise.all([
    paidIn(s._id),
    spentOn(s),
    blockers(s, now),
    cardFundings(s),
    SurveyActionModel.find({ surveyId: s._id, status: { $ne: 'screened-out' } }).select('status amount timeSpent'),
  ]);
  const count = (st: string) => actions.filter((a: any) => a.status === st).length;
  const perPerson = Number(s.plan?.pay?.perPerson) || s.surveyAmount || 0;
  const { places, minutes } = placesAndMinutes(methodOf(s), s.plan || {});
  const waitingIfApproved = round(b.toReview * perPerson * (1 + (await feeRateFor(userId))));
  const times = actions.filter((a: any) => a.timeSpent && ['approved', 'submitted'].includes(a.status)).map((a: any) => a.timeSpent).sort((x: number, y: number) => x - y);
  return {
    surveyId: String(s._id),
    name: titleOf(s),
    method: methodOf(s),
    status: s.status === 'published' ? 'live' : s.status,
    closedAt: s.closedAt || null,
    closedReason: s.closedReason || (s.status === 'closed' ? 'early' : null),
    toReview: b.toReview,
    stillFinishing: b.stillFinishing,
    unmarked: b.unmarked,
    settlesBy: s.settlement ? null : b.settlesBy,
    counts: {
      approved: count('approved'),
      rejected: count('rejected'),
      didntFinish: count('no-show') + (s.status === 'closed' && b.stillFinishing === 0 ? count('in-progress') : 0),
      places,
      unusedPlaces: Math.max(0, places - count('approved') - count('submitted')),
    },
    plannedMinutes: minutes,
    medianMinutes: times.length ? Math.round(times[Math.floor(times.length / 2)] / 60) : null,
    money: {
      currency: cur,
      paidIn: inSoFar,
      participants: spent.participants,
      fees: spent.fees,
      waitingIfApproved,
      unused: round(Math.max(0, inSoFar - spent.total - (s.settlement ? 0 : waitingIfApproved))),
    },
    returnTo: s.returnTo || 'credit',
    card: cards.length ? { last4: cards[0].cardLast4 || '' } : null,
    settlement: s.settlement || null,
  };
}

/** Choose where unused money goes. Can be changed until it settles. */
export async function setReturnTo(userId: string, id: string, to: 'credit' | 'card') {
  const s = await owned(userId, id);
  if (s.settlement) throw new AppError('This study’s money has already been settled.', 409, 'settled');
  if (to === 'card' && !(await cardFundings(s)).length) throw new AppError('This study wasn’t paid by card, so unused money comes back as credit.', 400, 'no_card');
  s.returnTo = to;
  await s.save();
  return finishView(userId, id);
}

/** Sends unused money back once a closed study has nothing left to decide. Safe to run twice. */
export async function settle(s: any, now = new Date()) {
  if (s.status !== 'closed' || s.settlement) return null;
  const b = await blockers(s, now);
  if (!b.clear) return null;
  const cur = s.currency || env.DEFAULT_CURRENCY;
  const inSoFar = await paidIn(s._id);
  const spent = await spentOn(s);
  const unused = round(Math.max(0, inSoFar - spent.total));
  let refunded = 0;
  const refunds: { number: string; last4: string; amount: number }[] = [];
  if (s.returnTo === 'card' && unused > 0) {
    for (const f of await cardFundings(s)) {
      const room = round(f.amount - (f.refunded || 0));
      const take = round(Math.min(room, unused - refunded));
      if (take <= 0) continue;
      await refundCard(f.providerRef, take);
      f.refunded = round((f.refunded || 0) + take);
      await f.save();
      await TransactionModel.updateOne(
        { ledgerKey: `${s._id}:refund:${f._id}` },
        { $setOnInsert: { ownerId: s.userId, ownerType: 'researcher', kind: 'refund', status: 'processing', amount: take, currency: cur, surveyId: s._id, description: `Unused money refunded to card ending ${f.cardLast4 || '••••'}` } },
        { upsert: true }
      );
      refunds.push({ number: f.number, last4: f.cardLast4 || '', amount: take });
      refunded = round(refunded + take);
      if (refunded >= unused) break;
    }
  }
  const credit = round(unused - refunded); // credit choice, bank transfers, and credit that was used to pay
  if (credit > 0) {
    await TransactionModel.updateOne(
      { ledgerKey: `${s._id}:settle-credit` },
      { $setOnInsert: { ownerId: s.userId, ownerType: 'researcher', kind: 'credit', status: 'available', amount: credit, currency: cur, surveyId: s._id, description: `Unused money from "${titleOf(s)}"` } },
      { upsert: true }
    );
  }
  const settlement = { at: now, paidIn: inSoFar, participants: spent.participants, fees: spent.fees, approved: spent.approved, unused, credit, refunded, refunds };
  const res = await SurveyModel.updateOne({ _id: s._id, settlement: { $exists: false } }, { $set: { settlement } });
  if (!res.modifiedCount) return null;
  s.settlement = settlement;
  const to = await studyContact(s, 'finish');
  const back = [credit > 0 && `${money(credit, cur)} added to your credit`, refunded > 0 && `${money(refunded, cur)} refunded to your card (5 to 10 days)`].filter(Boolean).join(' and ');
  await sendMail({
    to: to as string,
    subject: `Finished: ${titleOf(s)}`,
    text: `Everything is reviewed and paid: ${spent.approved} approved, ${money(spent.total, cur)} spent.${unused > 0 ? ` Unused: ${back}.` : ''}\n\nFinal statement and results: ${appUrl(`/dashboard/researcher/studies/${s._id}`)}`,
  });
  logger.info({ surveyId: String(s._id), unused, credit, refunded }, 'study settled');
  return settlement;
}

/** Closes studies that are full or past their close date, and settles closed ones that are ready. Every few minutes. */
export async function closeAndSettleDue(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  let closed = 0;
  let settled = 0;
  const live: any[] = await SurveyModel.find({ status: 'published', plan: { $exists: true } }).limit(1000);
  for (const s of live) {
    const pay = s.plan?.pay || {};
    let reason: 'date' | 'full' | null = pay.closes === 'date' && pay.closesAt && pay.closesAt < today ? 'date' : null;
    if (!reason) {
      const { places } = placesAndMinutes(methodOf(s), s.plan || {});
      const [done, ahead] = await Promise.all([
        SurveyActionModel.countDocuments({ surveyId: s._id, status: { $in: ['submitted', 'approved'] } }),
        BookingModel.countDocuments({ surveyId: s._id, status: 'booked' }),
      ]);
      if (places > 0 && done >= places && ahead === 0) reason = 'full';
    }
    if (!reason) continue;
    const res = await SurveyModel.updateOne({ _id: s._id, status: 'published' }, { $set: { status: 'closed', closedAt: now, closedReason: reason, paused: false } });
    if (!res.modifiedCount) continue;
    closed++;
    await cancelFutureBookings(s._id);
    await sendMail({
      to: (await studyContact(s, 'finish')) as string,
      subject: `Closed: ${titleOf(s)}`,
      text: `${reason === 'full' ? 'Every place is done' : 'It reached its close date'}, so your study has closed. Review any work still waiting; anything left is approved after ${AUTO_APPROVE_DAYS} days. Then the unused money comes back to you.\n\n${appUrl(`/dashboard/researcher/studies/${s._id}`)}`,
    });
  }
  const waiting: any[] = await SurveyModel.find({ status: 'closed', settlement: { $exists: false } }).limit(1000);
  for (const s of waiting) if (await settle(s, now)) settled++;
  return { closed, settled };
}

// ---------------------------------------------------------------- results and statement

const csvCell = (v: unknown) => {
  const t = v == null ? '' : String(v);
  return /[",\n\r]/.test(t) || /^[=+\-@]/.test(t) ? `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"` : t; // no spreadsheet formulas
};

/** One row per person who started. No names or contact details. */
export async function resultsCsv(userId: string, id: string, show: 'all' | 'approved' | 'other' = 'all', now = new Date()) {
  const s = await owned(userId, id);
  const filter: Record<string, unknown> = { surveyId: s._id, status: { $ne: 'screened-out' } };
  if (show === 'approved') filter.status = 'approved';
  if (show === 'other') filter.status = { $nin: ['approved', 'screened-out'] };
  const actions: any[] = await SurveyActionModel.find(filter).sort({ startedAt: 1 });
  const bookings: any[] = await BookingModel.find({ surveyId: s._id, status: { $ne: 'cancelled' } });
  const byAction = new Map(bookings.map((b) => [String(b.surveyActionId), b]));
  const graceOver = s.status === 'closed' && s.closedAt && now.getTime() - new Date(s.closedAt).getTime() > CLOSE_GRACE_MS;
  const questions: any[] = s.plan?.audience?.questions || [];
  const books = ['interview', 'focus-group'].includes(methodOf(s));
  const head = ['code', 'joinstudy_id', 'status', 'started_at', 'finished_at', 'minutes', 'finished_by', 'checks', 'decided_by', 'reason', 'note_to_participant', 'quota_group',
    ...questions.map((_q, i) => `question_${i + 1}`), ...(books ? ['booked_for', 'attendance'] : [])];
  const word: Record<string, string> = { 'in-progress': graceOver ? 'didn’t finish' : 'in progress', submitted: 'to review', approved: 'approved', rejected: 'rejected', 'no-show': 'didn’t join' };
  const rows = actions.map((a) => {
    const b = byAction.get(String(a._id));
    return [
      a.code || '',
      String(a._id),
      word[a.status] || a.status,
      a.startedAt ? new Date(a.startedAt).toISOString() : '',
      a.submittedAt ? new Date(a.submittedAt).toISOString() : '',
      a.timeSpent ? Math.max(1, Math.round(a.timeSpent / 60)) : '',
      a.finishedBy || '',
      flagsFor(a, s, new Set()).join(' '),
      a.review?.by || '',
      a.review?.reason ? REASONS[a.review.reason as keyof typeof REASONS]?.label || a.review.reason : '',
      a.review?.note || '',
      a.quotaGroup || '',
      ...questions.map((q, i) => (a.screenerAnswers?.[i] != null ? q.answers?.[a.screenerAnswers[i]]?.text ?? '' : '')),
      ...(books ? [b ? new Date(b.start).toISOString() : '', b ? ({ booked: 'booked', happened: 'joined', noshow: 'didn’t join' } as Record<string, string>)[b.status] || b.status : ''] : []),
    ];
  });
  const csv = [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const slug = titleOf(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'study';
  return { csv: '﻿' + csv, filename: `${slug}-results-${now.toISOString().slice(0, 10)}.csv`, rows: rows.length };
}

const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const day = (d: Date | string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** The study statement: paid in, paid to participants, fee, returned, balance. Final once settled. */
export async function statementDocument(userId: string, id: string) {
  const s = await owned(userId, id);
  const v = await finishView(userId, id);
  const cur = v.money.currency;
  const m = (n: number) => esc(money(n, cur));
  const fundings: any[] = await FundingModel.find({ surveyId: s._id, status: { $in: ['paid', 'refunded'] } }).sort({ paidAt: 1 });
  const r: any = await ResearcherModel.findById(userId).select('firstName lastName organizationName');
  const st: any = s.settlement;
  const lines: [string, string, string][] = fundings.map((f) => [day(f.paidAt || f.createdAt), `Paid${f.method === 'card' ? ` by card${f.cardLast4 ? ` ending ${f.cardLast4}` : ''}` : f.method === 'credit' ? ' with credit' : ' by bank transfer'} · ${f.number || ''}${f.purpose === 'add-places' ? ` (${f.extraPlaces} more places)` : ''}`, m((f.amount || 0) + (f.creditUsed || 0))]);
  lines.push(['', `Paid to ${v.counts.approved} participant${v.counts.approved === 1 ? '' : 's'}`, `−${m(v.money.participants)}`]);
  lines.push(['', 'joinStudy fee', `−${m(v.money.fees)}`]);
  if (st) {
    if (st.credit > 0) lines.push([day(st.at), 'Unused, returned as credit', `−${m(st.credit)}`]);
    for (const x of st.refunds || []) lines.push([day(st.at), `Unused, refunded to card ending ${esc(x.last4 || '••••')}`, `−${m(x.amount)}`]);
  }
  const balance = round(v.money.paidIn - v.money.participants - v.money.fees - (st ? st.unused : 0));
  const ref = fundings.find((f) => f.receipt?.reference)?.receipt?.reference;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Statement: ${esc(titleOf(s))}</title>
<style>body{font-family:system-ui,sans-serif;color:#120e22;max-width:760px;margin:32px auto;padding:0 20px;line-height:1.5}h1{font-size:22px;margin:0}table{width:100%;border-collapse:collapse;margin:20px 0}td{padding:9px 8px;border-bottom:1px solid #eee;vertical-align:top}td:last-child{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.tot td{font-weight:700;border-top:2px solid #120e22}.muted{color:#646080;font-size:13px}.grid{display:flex;flex-wrap:wrap;gap:24px}@media print{button{display:none}}</style></head><body>
<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px"><b style="font-size:20px">joinStudy</b><div style="text-align:right"><h1>${st ? 'Final statement' : 'Statement so far'}</h1><span class="muted">${esc(day(st?.at || new Date()))}</span></div></div>
<div class="grid" style="margin-top:20px"><div><span class="muted">For</span><br>${esc([r?.firstName, r?.lastName].filter(Boolean).join(' '))}${r?.organizationName ? `, ${esc(r.organizationName)}` : ''}${ref ? `<br>Reference ${esc(ref)}` : ''}</div>
<div><span class="muted">Study</span><br>${esc(titleOf(s))}<br>${esc(s.publishedAt ? day(s.publishedAt) : '')}${s.closedAt ? ` to ${esc(day(s.closedAt))}` : ' · still running'}</div></div>
<table>${lines.map(([d, w, a]) => `<tr><td class="muted">${esc(d)}</td><td>${esc(w)}</td><td>${a}</td></tr>`).join('')}<tr class="tot"><td></td><td>${st ? 'Balance' : 'Still held for this study'}</td><td>${m(balance)}</td></tr></table>
<p>Started: ${v.counts.approved + v.counts.rejected + v.counts.didntFinish + v.toReview} · Approved and paid: ${v.counts.approved} · Rejected: ${v.counts.rejected} · Didn't finish: ${v.counts.didntFinish}${v.toReview ? ` · To review: ${v.toReview}` : ''}</p>
<p class="muted">Participants were paid only for approved work. Rejected and unfinished work was not charged. Questions: hello@joinstudy.io</p>
<button onclick="print()">Print or save as PDF</button></body></html>`;
}

/** "Run it again": a new draft with the same plan (dates cleared), ready to check and pay for. */
export async function runAgain(userId: string, id: string) {
  const s = await owned(userId, id);
  if (!s.plan) throw new AppError('Only studies made in the planner can be copied.', 400);
  const plan = JSON.parse(JSON.stringify(s.plan));
  if (plan.pay) {
    delete plan.pay.opensAt;
    delete plan.pay.closesAt;
    if (plan.pay.opens === 'date') plan.pay.opens = 'approved';
    if (plan.pay.closes === 'date') plan.pay.closes = 'full';
  }
  if (plan.setup?.sessions) plan.setup.sessions = []; // past sessions can't be booked
  if (plan.setup?.from) { delete plan.setup.from; delete plan.setup.to; }
  const copy: any = await SurveyModel.create({
    plan,
    userId,
    projectId: s.projectId,
    method: s.method,
    surveyType: s.surveyType,
    surveyName: titleOf(s),
    currency: s.currency,
  });
  return { surveyId: String(copy._id) };
}

/** For the Payments page: closed studies, with what came back. */
export async function closedStudies(userId: string) {
  const list: any[] = await SurveyModel.find({ userId, status: 'closed' }).sort({ closedAt: -1 }).limit(100);
  const out = [];
  for (const s of list) {
    const waiting = await SurveyActionModel.countDocuments({ surveyId: s._id, status: 'submitted' });
    out.push({ surveyId: String(s._id), name: titleOf(s), closedAt: s.closedAt, settlement: s.settlement || null, toReview: waiting, returnTo: s.returnTo || 'credit' });
  }
  const since = new Date(Date.now() - 10 * DAY);
  const refunds: any[] = await TransactionModel.find({ ownerId: new Types.ObjectId(userId), kind: 'refund', createdAt: { $gte: since } }).select('amount');
  return { studies: out, refundsOnTheWay: round(refunds.reduce((t, x) => t + x.amount, 0)) };
}
