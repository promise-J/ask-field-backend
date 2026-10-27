import crypto from 'crypto';
import { isValidObjectId, Types } from 'mongoose';
import AppError from '../../error-helpers/appError';
import { env } from '../../config/env';
import logger from '../../config/logger';
import { sendMail } from '../../utils/mailer';
import { SurveyActionModel, SurveyModel } from '../survey/survey.model';
import { ParticipantModel } from '../user/models/participant.model';
import { ResearcherModel } from '../user/models/researcher.model';
import { ageOn } from '../user/controllers/participant.controller';
import { fitsStudy, hourly, isOpenNow, placesAndMinutes, toSex, type Method } from '../survey/plan';
import { VERIFY_FIRST } from '../verification/gate';
import { WalletService } from '../wallet/wallet.service';

const wallet = new WalletService();
import { HIDE_REASONS, StudyHideModel, type HideReason } from './studyHide.model';
import { holdsPlaces, takenCounts } from '../survey/holds';
import { isExpired, outcomeOf, SurveyService } from '../survey/survey.service';
import { cancelBooking } from '../run/booking.service';
import { BookingModel } from '../run/booking.model';
import { studyContact } from '../team/contact';

const surveys = new SurveyService();

/**
 * Participant Stage 3: finding studies (canvas 3.1–3.4).
 * Home, the list of studies that fit, a page per study, "Not interested", and the new-study email.
 */

const DONE = ['submitted', 'approved'];
// Statuses that take a study off someone's list for good.
const FINISHED = [...DONE, 'rejected', 'screened-out', 'no-show'];
const round = (n: number) => Math.round(n * 100) / 100;
const methodOf = (s: any): Method => s.method || (s.surveyType === 'aiTaskBuilder' ? 'ai-evaluation' : 'survey');
const BOOKED: Method[] = ['interview', 'focus-group'];
const NOT_FOR_YOU = 'This study is looking for a different group of people.';

export const REASON_LABELS: Record<HideReason, string> = {
  'too-long': 'Takes too long',
  'pay-low': 'Pay is too low',
  topic: 'Not my topic',
  timing: 'Bad timing',
  other: 'Something else',
};

/** Does this person fit this study? Planner studies use the plan; older studies only have age and gender. */
export function fitOf(s: any, participant: any, now = new Date()): { ok: boolean; reason?: string } {
  if (s.plan?.audience) return fitsStudy(s.plan, participant, now);
  const p = participant?.profile || {};
  if (s.minimumAge || s.maximumAge) {
    if (!p.dateOfBirth) return { ok: false, reason: 'Add your month and year of birth to your profile.' };
    const age = ageOn(new Date(p.dateOfBirth), now);
    if ((s.minimumAge && age < s.minimumAge) || (s.maximumAge && age > s.maximumAge)) {
      return { ok: false, reason: `It's for people aged ${s.minimumAge ?? 18} to ${s.maximumAge ?? 'any age'}.` };
    }
  }
  const wanted = toSex(s.gender);
  if ((wanted === 'female' || wanted === 'male') && toSex(p.gender) !== wanted) {
    return { ok: false, reason: `It's for ${wanted === 'female' ? 'women' : 'men'} only.` };
  }
  return { ok: true };
}

const verificationOf = (participant: any) => {
  const status: string = participant?.verification?.status || 'none';
  const required = env.REQUIRE_PARTICIPANT_VERIFICATION;
  return {
    required,
    status,
    verified: status === 'verified',
    // Can they start a study today, as far as verification goes?
    clear: !required || status === 'verified',
    blockedMessage: required && status !== 'verified' && VERIFY_FIRST[status] ? VERIFY_FIRST[status] : null,
  };
};

async function researchersOf(surveys: any[]) {
  const ids = [...new Set(surveys.map((s) => String(s.userId)))];
  const people = ids.length ? await ResearcherModel.find({ _id: { $in: ids } }).select('firstName lastName organizationName companyName') : [];
  return new Map(
    people.map((r: any) => [String(r._id), { name: `${r.firstName || ''} ${r.lastName || ''}`.trim(), organization: r.organizationName || r.companyName || '' }])
  );
}

/** Places taken: finishers, plus people still within their time on link-based studies (Participant Stage 4). */
async function filledCounts(surveys: any[], now = new Date()) {
  const ids = surveys.map((s) => s._id as Types.ObjectId);
  if (!ids.length) return new Map<string, number>();
  const [done, held] = await Promise.all([
    SurveyActionModel.aggregate([{ $match: { surveyId: { $in: ids }, status: { $in: DONE } } }, { $group: { _id: '$surveyId', n: { $sum: 1 } } }]),
    takenCounts(surveys.filter(holdsPlaces).map((s) => s._id), now),
  ]);
  const out = new Map<string, number>(done.map((r: any) => [String(r._id), r.n]));
  for (const [k, n] of held) out.set(k, n);
  return out;
}

/** The facts on a study card and at the top of a study page. Pay is in the study's currency (USD by default). */
export function cardOf(s: any, extra: { filled?: number; researcher?: { name: string; organization: string } | null } = {}) {
  const plan = s.plan || {};
  const method = methodOf(s);
  const fromPlan = placesAndMinutes(method, plan);
  const minutes = Number(s.surveyDuration) || fromPlan.minutes || 0;
  const pay = Number(s.surveyAmount) || Number(plan.pay?.perPerson) || 0;
  const places = Number(s.numberOfParticipants || s.totalSubmission) || fromPlan.places || 0;
  return {
    id: String(s._id),
    title: plan.basics?.title || s.surveyName,
    summary: String(s.surveyDescription || plan.basics?.description || '').slice(0, 280),
    method,
    minutes,
    pay: round(pay),
    hourly: hourly(pay, minutes),
    currency: s.currency || env.DEFAULT_CURRENCY,
    places,
    placesLeft: Math.max(0, places - (extra.filled ?? 0)),
    closesAt: plan.pay?.closes === 'date' ? plan.pay.closesAt || null : null,
    books: BOOKED.includes(method),
    devices: (plan.setup?.devices as string[]) || s.usableDevices || [],
    researcher: extra.researcher ?? null,
    publishedAt: s.publishedAt || null,
  };
}

/** Live studies with places left, newest first. */
async function openStudies(now = new Date(), extraFilter: Record<string, unknown> = {}) {
  const surveys: any[] = await SurveyModel.find({ status: 'published', paused: { $ne: true }, ...extraFilter })
    .select('-internalSurveyName -returnCode')
    .sort({ publishedAt: -1 })
    .limit(300);
  const open = surveys.filter((s) => isOpenNow(s, now));
  const filled = await filledCounts(open, now);
  return open
    .map((s) => ({ s, filled: filled.get(String(s._id)) || 0 }))
    .filter(({ s, filled: n }) => n < cardOf(s).places);
}

/** Studies this person fits and hasn't done, hidden or started. */
export async function studiesFor(participant: any, now = new Date()) {
  const pid = participant._id;
  const [open, actions, hides] = await Promise.all([
    openStudies(now),
    SurveyActionModel.find({ participantId: pid }).select('surveyId status'),
    StudyHideModel.find({ participantId: pid }).select('surveyId'),
  ]);
  const skip = new Set([...actions.map((a: any) => String(a.surveyId)), ...hides.map((h: any) => String(h.surveyId))]);
  const fits = open.filter(({ s }) => !skip.has(String(s._id)) && fitOf(s, participant, now).ok);
  const who = await researchersOf(fits.map(({ s }) => s));
  return fits.map(({ s, filled }) => cardOf(s, { filled, researcher: who.get(String(s.userId)) ?? null }));
}

/** "You qualify for N studies, paying…" (canvas 2.4 and the verify page). */
export async function qualifyingFor(participant: any) {
  if (!participant.isCompleteProfile) return { count: 0, minPay: 0, maxPay: 0, currency: env.DEFAULT_CURRENCY };
  const list = await studiesFor(participant);
  const pays = list.map((c) => c.pay);
  return {
    count: list.length,
    minPay: pays.length ? Math.min(...pays) : 0,
    maxPay: pays.length ? Math.max(...pays) : 0,
    currency: list[0]?.currency || env.DEFAULT_CURRENCY,
  };
}

async function me(participantId: string) {
  const p: any = await ParticipantModel.findById(participantId);
  if (!p) throw new AppError('Account not found.', 404);
  return p;
}

/** Canvas 3.1: one home for wherever the person is. */
export async function home(participantId: string) {
  const p = await me(participantId);
  const v = verificationOf(p);
  const complete = !!p.isCompleteProfile;
  const parts = p.profile?.parts || {};
  const [studies, hiddenCount, active, doneCount, money] = await Promise.all([
    complete ? studiesFor(p) : Promise.resolve([]),
    StudyHideModel.countDocuments({ participantId: p._id }),
    SurveyActionModel.find({ participantId: p._id, $or: [{ status: 'in-progress' }, { status: 'timed-out', endedAt: { $gte: new Date(Date.now() - 3 * 864e5) } }] }).sort({ startedAt: -1 }).limit(5),
    SurveyActionModel.countDocuments({ participantId: p._id, status: { $in: DONE } }),
    wallet.participantSummary(participantId),
  ]);
  const activeSurveys: any[] = active.length ? await SurveyModel.find({ _id: { $in: active.map((a: any) => a.surveyId) } }) : [];
  const byId = new Map(activeSurveys.map((s) => [String(s._id), s]));
  const inProgress = active
    .map((a: any) => {
      const s = byId.get(String(a.surveyId));
      if (!s || s.status === 'draft') return null;
      const expired = a.status === 'timed-out' || isExpired(a);
      // A time-out only matters while the study is still open (they can start again, or still finish).
      if (expired && s.status !== 'published') return null;
      return {
        id: String(s._id),
        title: s.plan?.basics?.title || s.surveyName,
        pay: round(Number(a.amount) || 0),
        currency: a.currency || s.currency || env.DEFAULT_CURRENCY,
        startedAt: a.startedAt,
        heldUntil: expired ? null : a.heldUntil || null,
        expired,
        books: BOOKED.includes(methodOf(s)),
      };
    })
    .filter(Boolean);

  let situation: 'profile' | 'waiting' | 'verify' | 'ready' | 'all-set';
  if (!complete) situation = 'profile';
  else if (!studies.length) situation = doneCount > 0 ? 'all-set' : 'waiting';
  else situation = v.clear ? 'ready' : 'verify';

  const pays = studies.map((c: any) => c.pay as number);
  return {
    firstName: p.firstName,
    situation,
    profile: { complete, parts: { where: !!parts.where, languages: !!parts.languages, work: !!parts.work } },
    verification: { required: v.required, status: v.status, verified: v.verified, message: v.blockedMessage },
    studies,
    payRange: pays.length ? { min: Math.min(...pays), max: Math.max(...pays) } : null,
    hiddenCount,
    inProgress,
    doneCount,
    alerts: { email: !!p.receivesUpdates },
    money: { currency: money.currency, waiting: money.pending, ready: money.available, minPayout: money.minPayout },
  };
}

/** Canvas 3.2: a page per study, whether or not it fits. */
export async function studyPage(participantId: string, id: string, now = new Date()) {
  if (!isValidObjectId(id)) throw new AppError('Study not found.', 404);
  const [p, s]: any[] = await Promise.all([me(participantId), SurveyModel.findById(id).select('-internalSurveyName')]);
  if (!s || s.status === 'draft') throw new AppError('Study not found.', 404);
  const [action, hide, filled, who]: any[] = await Promise.all([
    SurveyActionModel.findOne({ surveyId: s._id, participantId: p._id }).select('status startedAt heldUntil late leftReason'),
    StudyHideModel.findOne({ participantId: p._id, surveyId: s._id }).select('reason'),
    filledCounts([s], now),
    researchersOf([s]),
  ]);
  const card = cardOf(s, { filled: filled.get(String(s._id)) || 0, researcher: who.get(String(s.userId)) ?? null });
  const plan = s.plan || {};
  const b = plan.basics || {};
  const v = verificationOf(p);
  const live = s.status === 'published' && !s.paused && isOpenNow(s, now);
  const open = live && card.placesLeft > 0;
  const fit = p.isCompleteProfile ? fitOf(s, p, now) : { ok: false, reason: 'Finish “About you” first, so we can tell if this study fits you.' };
  const mine: string | null = action ? (isExpired(action, now) ? 'timed-out' : action.status) : null;
  // Left, or ran out of time: they can start again while there's a place (Participant Stage 4).
  const again = mine === 'left' || mine === 'timed-out';

  // What the page can offer, in order of what blocks it.
  let state: 'in-progress' | 'done' | 'closed' | 'full' | 'not-for-you' | 'verify' | 'blocked' | 'start';
  if (mine === 'in-progress') state = 'in-progress';
  else if (mine && !again) state = 'done';
  else if (!live) state = 'closed';
  else if (!open) state = 'full';
  else if (!fit.ok) state = 'not-for-you';
  else if (v.blockedMessage) state = 'blocked';
  else if (!v.clear) state = 'verify';
  else state = 'start';

  return {
    ...card,
    description: s.surveyDescription || b.description || '',
    ethics: b.ethics?.body ? `${b.ethics.body}${b.ethics.reference ? `, ${b.ethics.reference}` : ''}` : '',
    consent: b.consent?.mode === 'joinstudy' ? { required: true, text: b.consent.text || '' } : { required: false, text: '' },
    warning: b.sensitive ? b.warning || '' : s.contentWarning && !/^none$/i.test(s.contentWarning.trim()) ? s.contentWarning : '',
    hasQuestions: (plan.audience?.questions || []).length > 0,
    tasks: methodOf(s) === 'product-test' ? plan.setup?.tasks || [] : [],
    equipment: s.surveyEquipment || '',
    state,
    myStatus: mine,
    // Participant Stage 4: the hold, the finish code option, and how a finished attempt went.
    heldUntil: mine === 'in-progress' ? action.heldUntil || null : null,
    holds: holdsPlaces(s),
    hasCode: holdsPlaces(s) && !!s.returnCode,
    outcome: mine && !again && action ? outcomeOf(action) : null,
    fit: { ok: fit.ok, reason: fit.ok ? null : fit.reason || NOT_FOR_YOU },
    verification: { required: v.required, status: v.status, message: v.blockedMessage },
    hidden: hide ? { reason: hide.reason || null } : null,
    paidWithin: plan.pay?.review === 'auto' ? 'right away' : 'within 7 days',
  };
}

/** Canvas 3.3: "Not interested". Hides it for this person only; the reason is optional. */
export async function hide(participantId: string, id: string, reason?: HideReason) {
  if (!isValidObjectId(id)) throw new AppError('Study not found.', 404);
  const s = await SurveyModel.exists({ _id: id, status: { $ne: 'draft' } });
  if (!s) throw new AppError('Study not found.', 404);
  if (reason && !HIDE_REASONS.includes(reason)) throw new AppError('Choose one of the reasons, or none.', 400);
  await StudyHideModel.updateOne(
    { participantId, surveyId: id },
    reason ? { $set: { reason } } : { $setOnInsert: { participantId } },
    { upsert: true }
  );
  return { hidden: true };
}

export async function unhide(participantId: string, id: string) {
  if (!isValidObjectId(id)) throw new AppError('Study not found.', 404);
  await StudyHideModel.deleteOne({ participantId, surveyId: id });
  return { hidden: false };
}

/** Hidden studies that are still open, so they can be brought back. */
export async function hiddenList(participantId: string, now = new Date()) {
  const hides: any[] = await StudyHideModel.find({ participantId }).sort({ createdAt: -1 });
  if (!hides.length) return [];
  const open = await openStudies(now, { _id: { $in: hides.map((h) => h.surveyId) } });
  const by = new Map(open.map((x) => [String(x.s._id), x]));
  const who = await researchersOf(open.map((x) => x.s));
  return hides
    .filter((h) => by.has(String(h.surveyId)))
    .map((h) => {
      const { s, filled } = by.get(String(h.surveyId))!;
      return { ...cardOf(s, { filled, researcher: who.get(String(s.userId)) ?? null }), reason: h.reason || null, reasonLabel: h.reason ? REASON_LABELS[h.reason as HideReason] : null };
    });
}

/** For the researcher: how many hid the study and why. Totals only, never who. */
export async function declineCounts(surveyId: Types.ObjectId | string) {
  const rows = await StudyHideModel.aggregate([
    { $match: { surveyId: new Types.ObjectId(String(surveyId)) } },
    { $group: { _id: '$reason', n: { $sum: 1 } } },
  ]);
  const reasons = Object.fromEntries(HIDE_REASONS.map((r) => [r, 0])) as Record<HideReason, number>;
  let total = 0;
  for (const r of rows) {
    total += r.n;
    if (r._id) reasons[r._id as HideReason] = r.n;
  }
  return { total, reasons };
}

// ---------- canvas 3.4: the new-study email ----------

const ALERT_GAP_MS = 23.5 * 3600e3; // at most one a day (a little slack so a daily run never skips a day)
const alertToken = (id: string) => crypto.createHmac('sha256', env.JWT_SECRET).update(`study-alerts:${id}`).digest('hex').slice(0, 32);
const site = () => env.FRONTEND_URL.replace(/\/$/, '');
const money = (n: number, cur: string) => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' }).format(n);
  } catch {
    return `${cur} ${n.toFixed(2)}`;
  }
};

export async function setAlerts(participantId: string, on: boolean) {
  const p = await me(participantId);
  p.receivesUpdates = on;
  await p.save();
  return { email: on };
}

/** The "Stop these emails" link: works without signing in. */
export async function stopAlertsByLink(id: string, token: string) {
  const ok = isValidObjectId(id) && typeof token === 'string' && token.length === 32 && crypto.timingSafeEqual(Buffer.from(alertToken(id)), Buffer.from(token));
  if (!ok) throw new AppError('This link isn’t valid. You can turn study emails off in your profile.', 400, 'bad_link');
  await ParticipantModel.updateOne({ _id: id }, { $set: { receivesUpdates: false } });
  return { email: false };
}

export function alertEmail(p: any, cards: ReturnType<typeof cardOf>[]) {
  const first = cards[0];
  const stop = `${site()}/participate/stop-emails?u=${p._id}&t=${alertToken(String(p._id))}`;
  const link = cards.length === 1 ? `${site()}/dashboard/participant/studies/${first.id}` : `${site()}/dashboard/participant`;
  const top = Math.max(...cards.map((c) => c.pay));
  const subject =
    cards.length === 1
      ? `A new study fits you: ${money(first.pay, first.currency)} for ${first.minutes} minutes`
      : `${cards.length} new studies fit you, up to ${money(top, first.currency)}`;
  const lines = cards.slice(0, 5).map((c) => `${c.title}: ${money(c.pay, c.currency)}, about ${c.minutes} minutes`);
  const text = [
    `Hi ${p.firstName},`,
    '',
    cards.length === 1 ? 'A new study fits you:' : `${cards.length} new studies fit you:`,
    ...lines,
    '',
    `See ${cards.length === 1 ? 'it' : 'them'}: ${link}`,
    '',
    'Places go to the first people who take part. We send at most one of these a day.',
    `Stop these emails: ${stop}`,
  ].join('\n');
  const esc = (x: string) => x.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
  const rows = cards
    .slice(0, 5)
    .map((c) => `<tr><td style="padding:10px 0;border-bottom:1px solid #ebe9f2"><b>${esc(c.title)}</b><br><span style="color:#646080;font-size:13px">${c.minutes} min · ${money(c.hourly, c.currency)}/hr</span></td><td style="padding:10px 0;border-bottom:1px solid #ebe9f2;text-align:right;font-weight:700">${money(c.pay, c.currency)}</td></tr>`)
    .join('');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#120e22;max-width:520px"><p>Hi ${esc(p.firstName || '')},</p><p><b>${cards.length === 1 ? 'A new study fits you' : `${cards.length} new studies fit you`}</b></p><table style="width:100%;border-collapse:collapse">${rows}</table><p><a href="${link}" style="display:inline-block;background:#f0c93a;color:#251d00;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">${cards.length === 1 ? 'See the study' : 'See the studies'}</a></p><p style="color:#646080;font-size:13px">Places go to the first people who take part. We send at most one of these a day.</p><p style="color:#7f7a96;font-size:12px">You're getting this because you said yes to study emails. <a href="${stop}" style="color:#7f7a96">Stop these emails</a>.</p></div>`;
  return { to: p.email, subject, text, html };
}

/**
 * Runs every hour. Emails each opted-in person once a day at most, about studies published since their
 * last email (or since they joined) that fit them and they haven't seen through to the end.
 */
export async function sendStudyAlerts(now = new Date()) {
  const recent = await openStudies(now, { publishedAt: { $gte: new Date(now.getTime() - 8 * 864e5) } });
  if (!recent.length) return { sent: 0 };
  const oldest = new Date(Math.min(...recent.map((x) => new Date(x.s.publishedAt).getTime())));
  const cursor = ParticipantModel.find({
    receivesUpdates: true,
    isCompleteProfile: true,
    isVerified: true,
    'verification.status': { $nin: ['duplicate', 'rejected'] },
    $or: [{ studyAlertAt: { $exists: false } }, { studyAlertAt: null }, { studyAlertAt: { $lt: new Date(now.getTime() - ALERT_GAP_MS) } }],
  }).cursor();
  let sent = 0;
  for await (const p of cursor as any) {
    const since = new Date(Math.max(new Date(p.studyAlertAt || p.createdAt || 0).getTime(), oldest.getTime() - 1));
    const fresh = recent.filter(({ s }) => new Date(s.publishedAt) > since);
    if (!fresh.length) continue;
    const [actions, hides] = await Promise.all([
      SurveyActionModel.find({ participantId: p._id, surveyId: { $in: fresh.map((x) => x.s._id) } }).select('surveyId'),
      StudyHideModel.find({ participantId: p._id, surveyId: { $in: fresh.map((x) => x.s._id) } }).select('surveyId'),
    ]);
    const skip = new Set([...actions, ...hides].map((a: any) => String(a.surveyId)));
    const cards = fresh.filter(({ s }) => !skip.has(String(s._id)) && fitOf(s, p, now).ok).map(({ s, filled }) => cardOf(s, { filled }));
    if (!cards.length) continue;
    // Claim the slot first so two servers never send the same day's email twice.
    const claimed = await ParticipantModel.updateOne(
      { _id: p._id, $or: [{ studyAlertAt: { $exists: false } }, { studyAlertAt: null }, { studyAlertAt: p.studyAlertAt ?? null }] },
      { $set: { studyAlertAt: now } }
    );
    if (!claimed.modifiedCount) continue;
    try {
      await sendMail(alertEmail(p, cards));
      sent += 1;
    } catch (error) {
      logger.error({ error, participantId: String(p._id) }, 'Study alert failed');
    }
  }
  return { sent };
}

// ---------- Participant Stage 4: leaving a study (canvas 4.4) ----------

export const LEAVE_REASONS = ['longer', 'link-broken', 'came-up', 'uncomfortable', 'other'] as const;
export type LeaveReason = (typeof LEAVE_REASONS)[number];

/** Frees the place. Interviews and groups cancel the booking too (12 hours' notice, as before). */
export async function leaveStudy(participantId: string, surveyId: string, reason?: LeaveReason) {
  if (!isValidObjectId(surveyId)) throw new AppError('Study not found.', 404);
  const booking: any = await BookingModel.findOne({ surveyId, participantId, status: 'booked' });
  if (booking) await cancelBooking(participantId, String(booking._id));
  await surveys.leave(participantId, surveyId, reason);
  if (reason === 'link-broken') await tellResearcherLinkBroken(surveyId);
  return { left: true };
}

/** "The link didn't work": the researcher hears once a day at most, not once per person. */
async function tellResearcherLinkBroken(surveyId: string) {
  const dayAgo = new Date(Date.now() - 864e5);
  const s: any = await SurveyModel.findOneAndUpdate(
    { _id: surveyId, $or: [{ linkProblemAt: { $exists: false } }, { linkProblemAt: null }, { linkProblemAt: { $lt: dayAgo } }] },
    { $set: { linkProblemAt: new Date() } },
    { new: true }
  );
  if (!s) return;
  const to = await studyContact(s);
  if (!to) return;
  const title = s.plan?.basics?.title || s.surveyName;
  await sendMail({
    to,
    subject: `Someone couldn't open your study link: ${title}`,
    text: `A participant left "${title}" because the study link didn't work for them.\n\nOpen the link on a phone to check it works: ${s.surveyURL || s.plan?.setup?.url || '(no link set)'}\n\nWe'll tell you again tomorrow if it happens again.\n\nStudy: ${site()}/dashboard/researcher/studies/${s._id}`,
  });
}

/** For the researcher: how many left, and why. Totals only. */
export async function leaveCounts(surveyId: Types.ObjectId | string) {
  const rows = await SurveyActionModel.aggregate([
    { $match: { surveyId: new Types.ObjectId(String(surveyId)), status: { $in: ['left', 'timed-out'] } } },
    { $group: { _id: { status: '$status', reason: '$leftReason' }, n: { $sum: 1 } } },
  ]);
  const reasons = Object.fromEntries(LEAVE_REASONS.map((r) => [r, 0])) as Record<LeaveReason, number>;
  let left = 0;
  let timedOut = 0;
  for (const r of rows) {
    if (r._id.status === 'timed-out') timedOut += r.n;
    else {
      left += r.n;
      if (r._id.reason) reasons[r._id.reason as LeaveReason] += r.n;
    }
  }
  return { left, timedOut, reasons };
}
