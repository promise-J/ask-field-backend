import { isValidObjectId, Types } from 'mongoose';
import AppError from '../../error-helpers/appError';
import { env } from '../../config/env';
import { SurveyActionModel, SurveyModel } from '../survey/survey.model';
import { TransactionModel } from '../wallet/transaction.model';
import { FundingModel } from '../billing/funding.model';
import { paidIn } from '../billing/launch.service';
import { placesAndMinutes } from '../survey/plan';
import { BookingModel } from './booking.model';
import { cancelFutureBookings } from './booking.service';

/** Stage 6: what a live study looks like while it runs, and the changes a researcher can make. */

const round = (n: number) => Math.round(n * 100) / 100;
const DONE = ['submitted', 'approved'];
const methodOf = (s: any) => s.method || 'survey';
export const CLOSE_GRACE_MS = 2 * 3600e3; // people mid-study get 2 hours to finish after an early close

async function owned(userId: string, id: string) {
  if (!isValidObjectId(id)) throw new AppError('Study not found.', 404);
  const s: any = await SurveyModel.findOne({ _id: id, userId });
  if (!s) throw new AppError('Study not found.', 404);
  return s;
}

export async function liveView(userId: string, id: string, now = new Date()) {
  const s = await owned(userId, id);
  const method = methodOf(s);
  const plan = s.plan || {};
  const { places, minutes } = placesAndMinutes(method, plan);
  const actions: any[] = await SurveyActionModel.find({ surveyId: s._id }).select('status startedAt submittedAt timeSpent quotaGroup code');
  const count = (st: string) => actions.filter((a) => a.status === st).length;
  const approved = count('approved');
  const toReview = count('submitted');
  const inProgress = count('in-progress');
  // "Stuck": started long ago and never reached the finish link (often a survey that forgets to send people back).
  const stuckAfter = Math.max(2 * 3600e3, minutes * 4 * 60000);
  const stuck = method === 'survey' || method === 'product-test' || method === 'ai-evaluation'
    ? actions.filter((a) => a.status === 'in-progress' && now.getTime() - new Date(a.startedAt).getTime() > stuckAfter).map((a) => ({ code: a.code, participantSince: a.startedAt }))
    : [];
  const times = actions.filter((a) => DONE.includes(a.status) && a.timeSpent).map((a) => a.timeSpent as number).sort((a, b) => a - b);
  const median = times.length ? Math.round(times[Math.floor(times.length / 2)] / 60) : null;
  const perDay: { day: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 864e5).toISOString().slice(0, 10);
    perDay.push({ day, count: actions.filter((a) => DONE.includes(a.status) && a.submittedAt && new Date(a.submittedAt).toISOString().slice(0, 10) === day).length });
  }
  const quota = plan.audience?.quota;
  const quotas = quota
    ? quota.groups.map((g: any) => ({ value: g.value, places: g.places, done: actions.filter((a) => a.quotaGroup === g.value && DONE.includes(a.status)).length }))
    : [];
  const [inSoFar, charges] = await Promise.all([
    paidIn(s._id),
    TransactionModel.find({ surveyId: s._id, kind: 'charge', status: 'paid' }).select('amount'),
  ]);
  const paidOut = round(charges.reduce((t, c: any) => t + c.amount, 0));
  let bookings = null as null | { booked: number; happened: number; noshow: number; next: { start: Date; code: string }[] };
  if (method === 'interview' || method === 'focus-group') {
    const list: any[] = await BookingModel.find({ surveyId: s._id, status: { $ne: 'cancelled' } }).sort({ start: 1 });
    const codes = new Map(actions.map((a) => [String(a._id), a.code]));
    bookings = {
      booked: list.filter((b) => b.status === 'booked').length,
      happened: list.filter((b) => b.status === 'happened').length,
      noshow: list.filter((b) => b.status === 'noshow').length,
      next: list.filter((b) => b.status === 'booked' && b.start > now).slice(0, 3).map((b) => ({ start: b.start, code: codes.get(String(b.surveyActionId)) || 'P-?' })),
    };
  }
  return {
    surveyId: String(s._id),
    projectId: String(s.projectId),
    name: plan.basics?.title || s.surveyName,
    method,
    status: s.status === 'published' ? 'live' : s.status,
    paused: !!s.paused,
    publishedAt: s.publishedAt,
    closedAt: s.closedAt || null,
    closes: plan.pay?.closes === 'date' ? plan.pay.closesAt : null,
    places,
    minutes,
    counts: { approved, toReview, inProgress, rejected: count('rejected'), screenedOut: count('screened-out'), noShow: count('no-show'), left: Math.max(0, places - approved - toReview) },
    medianMinutes: median,
    perDay,
    quotas,
    stuck,
    bookings,
    money: { paidIn: inSoFar, paidOut, held: round(Math.max(0, inSoFar - paidOut)), currency: s.currency || env.DEFAULT_CURRENCY },
    perPerson: Number(plan.pay?.perPerson) || 0,
    returnLink: s.returnCode ? `${env.FRONTEND_URL.replace(/\/$/, '')}/done/${s.returnCode}` : null,
  };
}

/** Participants on a study (for surveys and other link-based studies). */
export async function participantsOf(userId: string, id: string) {
  const s = await owned(userId, id);
  const list: any[] = await SurveyActionModel.find({ surveyId: s._id, status: { $ne: 'screened-out' } }).sort({ startedAt: -1 }).limit(500);
  return list.map((a) => ({ surveyActionId: String(a._id), participantId: String(a.participantId), code: a.code || 'P-?', status: a.status, startedAt: a.startedAt, submittedAt: a.submittedAt || null, minutes: a.timeSpent ? Math.round(a.timeSpent / 60) : null }));
}

export async function setPaused(userId: string, id: string, paused: boolean) {
  const s = await owned(userId, id);
  if (s.status !== 'published') throw new AppError('Only a live study can be paused.', 409);
  s.paused = paused;
  await s.save();
  return liveView(userId, id);
}

export async function setCloseDate(userId: string, id: string, date: string | null) {
  const s = await owned(userId, id);
  if (s.status !== 'published') throw new AppError('This study isn’t live.', 409);
  const today = new Date().toISOString().slice(0, 10);
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today)) throw new AppError('Choose today or a later date.', 400);
  s.plan = { ...s.plan, pay: { ...(s.plan?.pay || {}), closes: date ? 'date' : 'full', closesAt: date } };
  s.markModified('plan');
  await s.save();
  return liveView(userId, id);
}

/** Close early: no one new starts; people mid-study get 2 hours; future bookings are cancelled. */
export async function closeEarly(userId: string, id: string) {
  const s = await owned(userId, id);
  if (s.status === 'closed') return liveView(userId, id);
  if (s.status !== 'published') throw new AppError('This study isn’t live.', 409);
  s.status = 'closed';
  s.closedAt = new Date();
  s.paused = false;
  await s.save();
  await cancelFutureBookings(s._id);
  return liveView(userId, id);
}

/** People mid-study can still finish for a while after an early close. */
export function canStillSubmit(s: any, now = new Date()) {
  if (s.status === 'published') return true;
  return s.status === 'closed' && s.closedAt && now.getTime() - new Date(s.closedAt).getTime() < CLOSE_GRACE_MS;
}

/** After an "add places" payment: the study gets the places, quotas grow evenly. */
export async function applyExtraPlaces(surveyId: Types.ObjectId | string, extra: number, session?: string) {
  const s: any = await SurveyModel.findById(surveyId);
  if (!s || !extra) return;
  const plan = s.plan || {};
  if (methodOf(s) === 'focus-group') plan.setup = { ...plan.setup, sessions: [...(plan.setup?.sessions || []), session].filter(Boolean).sort() };
  else if (methodOf(s) === 'interview') plan.setup = { ...plan.setup, count: (Number(plan.setup?.count) || 0) + extra };
  else plan.pay = { ...plan.pay, places: (Number(plan.pay?.places) || 0) + extra };
  const q = plan.audience?.quota;
  if (q?.groups?.length) {
    const each = Math.floor(extra / q.groups.length);
    let rest = extra - each * q.groups.length;
    q.groups = q.groups.map((g: any) => ({ ...g, places: g.places + each + (rest-- > 0 ? 1 : 0) }));
  }
  s.plan = plan;
  s.markModified('plan');
  s.numberOfParticipants = placesAndMinutes(methodOf(s), plan).places;
  await s.save();
}

/** Interviews: more weekly times or a later end date. Free: the number of interviews doesn't change. */
export async function addTimes(userId: string, id: string, input: { weekly?: string[]; to?: string }) {
  const s = await owned(userId, id);
  if (s.status !== 'published') throw new AppError('This study isn’t live.', 409);
  if (methodOf(s) !== 'interview') throw new AppError('Only interviews have weekly times.', 400);
  const setup = s.plan?.setup || {};
  if (input.to && input.to < setup.to) throw new AppError(`Choose ${setup.to} or later.`, 400);
  s.plan = { ...s.plan, setup: { ...setup, weekly: [...new Set([...(setup.weekly || []), ...(input.weekly || [])])], to: input.to || setup.to } };
  s.markModified('plan');
  await s.save();
  return liveView(userId, id);
}

export const fundingsFor = (surveyId: string) => FundingModel.find({ surveyId, status: { $ne: 'cancelled' } });
