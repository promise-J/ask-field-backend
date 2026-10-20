import { isValidObjectId, Types } from 'mongoose';
import AppError from '../../error-helpers/appError';
import { env } from '../../config/env';
import { sendMail } from '../../utils/mailer';
import { SurveyActionModel, SurveyModel } from '../survey/survey.model';
import { SurveyService } from '../survey/survey.service';
import { placesAndMinutes } from '../survey/plan';
import { feeRateFor } from '../user/services/setup.service';
import { ParticipantModel } from '../user/models/participant.model';
import { ResearcherModel } from '../user/models/researcher.model';
import { BookingModel } from '../run/booking.model';
import { markHappened, markNoShow } from '../run/booking.service';
import { studyContact } from '../team/contact';

/**
 * Stage 7: review the work. Quality checks on each submission, approve or reject (one or many, with a reason
 * the participant sees), session attendance, and the 7-day automatic approval that pays people if nobody decides.
 */

export const AUTO_APPROVE_DAYS = 7;
const DAY = 864e5;
const REMIND_AFTER_DAYS = 5;
const LINK_METHODS = ['survey', 'product-test', 'ai-evaluation'];
const surveys = new SurveyService();

export const REASONS = {
  tasks: { label: 'Didn’t do what was asked', seen: 'the tasks or questions the study required weren’t completed' },
  attention: { label: 'Failed attention checks', seen: 'the attention checks in the study were missed' },
  'low-effort': { label: 'Answers show no real effort', seen: 'the answers didn’t show real effort' },
  'not-eligible': { label: 'Isn’t who the study is for', seen: 'the answers show you don’t match who the study is for' },
  other: { label: 'Something else', seen: 'see the researcher’s note' },
} as const;
export type Reason = keyof typeof REASONS;
export type Flag = 'fast' | 'no-link' | 'rejected-before' | 'late' | 'over';

const titleOf = (s: any) => s?.plan?.basics?.title || s?.surveyName || 'your study';
const methodOf = (s: any) => s?.method || 'survey';
const appUrl = (path: string) => `${env.FRONTEND_URL.replace(/\/$/, '')}${path}`;
export const autoApproveAt = (submittedAt: Date) => new Date(new Date(submittedAt).getTime() + AUTO_APPROVE_DAYS * DAY);

async function owned(userId: string, id: string) {
  if (!isValidObjectId(id)) throw new AppError('Study not found.', 404);
  const s: any = await SurveyModel.findOne({ _id: id, userId });
  if (!s) throw new AppError('Study not found.', 404);
  return s;
}

/** People with 2+ rejections anywhere on joinStudy in the last 90 days (not counting this study). */
async function rejectedBefore(participantIds: Types.ObjectId[], surveyId: Types.ObjectId) {
  const rows: any[] = await SurveyActionModel.find({
    participantId: { $in: participantIds },
    surveyId: { $ne: surveyId },
    status: 'rejected',
    reviewedAt: { $gte: new Date(Date.now() - 90 * DAY) },
  }).select('participantId');
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(String(r.participantId), (counts.get(String(r.participantId)) || 0) + 1);
  return new Set([...counts].filter(([, n]) => n >= 2).map(([id]) => id));
}

/** Flags are a reason to look, not to reject. */
export function flagsFor(a: any, s: any, repeat: Set<string>): Flag[] {
  const out: Flag[] = [];
  const { minutes } = placesAndMinutes(methodOf(s), s.plan || {});
  if (minutes && a.timeSpent && a.timeSpent < (minutes * 60) / 3) out.push('fast');
  if (LINK_METHODS.includes(methodOf(s)) && s.returnCode && a.finishedBy === 'self') out.push('no-link');
  if (repeat.has(String(a.participantId))) out.push('rejected-before');
  // Participant Stage 4: finished after their time ran out; 'over' means every place you paid for was already taken.
  if (a.late === 'over') out.push('over');
  else if (a.late === 'counted') out.push('late');
  return out;
}

export async function reviewView(userId: string, id: string) {
  const s = await owned(userId, id);
  const actions: any[] = await SurveyActionModel.find({ surveyId: s._id, status: { $in: ['submitted', 'approved', 'rejected'] } }).sort({ submittedAt: 1 });
  const repeat = await rejectedBefore(actions.filter((a) => a.status === 'submitted').map((a) => a.participantId), s._id);
  const { minutes } = placesAndMinutes(methodOf(s), s.plan || {});
  const items = actions.map((a) => ({
    surveyActionId: String(a._id),
    participantId: String(a.participantId),
    code: a.code || 'P-?',
    status: a.status,
    minutes: a.timeSpent ? Math.max(1, Math.round(a.timeSpent / 60)) : null,
    submittedAt: a.submittedAt,
    reviewedAt: a.reviewedAt || null,
    autoApproveAt: a.status === 'submitted' && a.submittedAt ? autoApproveAt(a.submittedAt) : null,
    flags: a.status === 'submitted' ? flagsFor(a, s, repeat) : [],
    finishedBy: a.finishedBy || null,
    review: a.review?.by ? { by: a.review.by, reason: a.review.reason || null, note: a.review.note || '' } : null,
    // Participant Stage 5: their question about a "not approved" decision, and the answer.
    question: a.appeal?.status
      ? { status: a.appeal.status, why: a.appeal.why, message: a.appeal.message || '', askedAt: a.appeal.askedAt, answerBy: new Date(new Date(a.appeal.askedAt).getTime() + 7 * DAY), answer: a.appeal.answer || '' }
      : null,
  }));
  const waiting = items.filter((i) => i.status === 'submitted');
  return {
    surveyId: String(s._id),
    name: titleOf(s),
    method: methodOf(s),
    plannedMinutes: minutes,
    perPerson: Number(s.plan?.pay?.perPerson) || s.surveyAmount || 0,
    feeRate: await feeRateFor(userId),
    currency: s.currency || env.DEFAULT_CURRENCY,
    autoApproveDays: AUTO_APPROVE_DAYS,
    reviewMode: s.plan?.pay?.review === 'auto' ? 'auto' : 'manual',
    counts: {
      toReview: waiting.length,
      flagged: waiting.filter((i) => i.flags.length).length,
      approved: items.filter((i) => i.status === 'approved').length,
      questions: items.filter((i) => i.question?.status === 'open').length,
      rejected: items.filter((i) => i.status === 'rejected').length,
    },
    soonest: waiting[0]?.autoApproveAt || null,
    reasons: Object.entries(REASONS).map(([key, r]) => ({ key, label: r.label })),
    items,
  };
}

async function tellParticipant(a: any, s: any, decision: 'approved' | 'rejected', reason?: Reason, note?: string) {
  const p: any = await ParticipantModel.findById(a.participantId).select('email');
  if (!p?.email) return;
  if (decision === 'approved') {
    await sendMail({ to: p.email, subject: `Approved: ${titleOf(s)}`, text: `Your work on "${titleOf(s)}" was approved. ${a.currency || env.DEFAULT_CURRENCY} ${Number(a.amount || 0).toFixed(2)} is in your joinStudy balance.` });
    return;
  }
  const why = REASONS[reason || 'other'].seen;
  await sendMail({
    to: p.email,
    subject: `Not approved: ${titleOf(s)}`,
    text: `Your response to "${titleOf(s)}" wasn't approved: ${why}.${note ? `\n\nThe researcher's note: ${note}` : ''}\n\nIf you think this is a mistake, you can ask about it within 14 days. The researcher can change their decision: ${appUrl(`/dashboard/participant/my-studies/${s._id}`)}`,
  });
}

/** Approve or reject one or many. Anything already decided (or not finished) is skipped and counted. */
export async function decide(userId: string, id: string, input: { ids: string[]; decision: 'approve' | 'reject'; reason?: Reason; note?: string }) {
  const s = await owned(userId, id);
  if (input.decision === 'reject') {
    if (!input.reason || !(input.reason in REASONS)) throw new AppError('Choose a reason. The participant sees it.', 400, 'reason_required');
    if (input.reason === 'other' && !input.note?.trim()) throw new AppError('Add a note explaining why.', 400, 'note_required');
  }
  const ids = [...new Set(input.ids)].filter(isValidObjectId);
  const actions: any[] = await SurveyActionModel.find({ _id: { $in: ids }, surveyId: s._id });
  let done = 0;
  const skipped: string[] = [];
  for (const a of actions) {
    if (a.status !== 'submitted') {
      skipped.push(a.code || String(a._id));
      continue;
    }
    const decision = input.decision === 'approve' ? 'approved' : 'rejected';
    const note = input.note?.trim() || undefined;
    await surveys.review(userId, String(a._id), decision, { by: 'researcher', reason: decision === 'rejected' ? input.reason : undefined, note, why: decision === 'rejected' ? REASONS[input.reason!].label : '' });
    await tellParticipant(a, s, decision, input.reason, note);
    done++;
  }
  skipped.push(...ids.filter((x) => !actions.some((a) => String(a._id) === x)));
  return { decision: input.decision, done, skipped: skipped.length, view: await reviewView(userId, id) };
}

/** Focus groups (and interviews): who joined one session, saved in one go. */
export async function saveAttendance(userId: string, id: string, input: { joined: string[]; missed: string[] }) {
  const s = await owned(userId, id);
  const all = [...input.joined, ...input.missed].filter(isValidObjectId);
  const list: any[] = await BookingModel.find({ _id: { $in: all }, surveyId: s._id, researcherId: userId });
  if (list.length !== new Set(all).size) throw new AppError('Some of those bookings aren’t part of this study.', 400);
  if (list.some((b) => b.start.getTime() > Date.now())) throw new AppError('You can save attendance once the session has started.', 409, 'not_yet');
  for (const b of list) {
    if (input.joined.includes(String(b._id))) await markHappened(userId, String(b._id), 'attendance');
    else if (b.status === 'booked') await markNoShow(userId, String(b._id));
  }
  return { joined: input.joined.length, missed: input.missed.length };
}

/** Everything waiting for this researcher, by study, oldest first (that's what gets approved first). */
export async function toReview(userId: string) {
  const [waiting, unmarked]: any[][] = await Promise.all([
    SurveyActionModel.find({ researcherId: userId, status: 'submitted' }).select('surveyId submittedAt timeSpent finishedBy participantId late'),
    BookingModel.find({ researcherId: userId, status: 'booked', end: { $lte: new Date() } }).select('surveyId start end'),
  ]);
  // Participant Stage 5: open questions about decisions also need the researcher.
  const asked: any[] = await SurveyActionModel.find({ researcherId: userId, 'appeal.status': 'open' }).select('surveyId appeal.askedAt');
  const ids = [...new Set([...waiting, ...unmarked, ...asked].map((x) => String(x.surveyId)))];
  const studies: any[] = await SurveyModel.find({ _id: { $in: ids }, userId });
  const rows = [];
  for (const s of studies) {
    const mine = waiting.filter((a) => String(a.surveyId) === String(s._id));
    const sessions = new Set(unmarked.filter((b) => String(b.surveyId) === String(s._id)).map((b) => b.start.toISOString()));
    const repeat = mine.length ? await rejectedBefore(mine.map((a) => a.participantId), s._id) : new Set<string>();
    const oldest = mine.reduce((m: Date | null, a) => (!m || a.submittedAt < m ? a.submittedAt : m), null);
    const oldestBooking = unmarked.filter((b) => String(b.surveyId) === String(s._id)).reduce((m: Date | null, b) => (!m || b.end < m ? b.end : m), null);
    const due = [oldest && autoApproveAt(oldest), oldestBooking && autoApproveAt(oldestBooking)].filter(Boolean) as Date[];
    rows.push({
      surveyId: String(s._id),
      name: titleOf(s),
      method: methodOf(s),
      count: mine.length,
      flagged: mine.filter((a) => flagsFor(a, s, repeat).length).length,
      toMark: sessions.size,
      questions: asked.filter((a) => String(a.surveyId) === String(s._id)).length,
      autoApproveAt: due.length ? new Date(Math.min(...due.map((d) => d.getTime()))) : null,
    });
  }
  return rows.sort((a, b) => (a.autoApproveAt?.getTime() ?? Infinity) - (b.autoApproveAt?.getTime() ?? Infinity));
}

// ---------------------------------------------------------------- scheduled (every few minutes; safe to run twice)

/** Work nobody decided on within 7 days is approved, which pays the participant. Unmarked bookings count as attended. */
export async function autoApproveDue(now = new Date()) {
  const cutoff = new Date(now.getTime() - AUTO_APPROVE_DAYS * DAY);
  let n = 0;
  const due: any[] = await SurveyActionModel.find({ status: 'submitted', submittedAt: { $lte: cutoff } }).limit(500);
  for (const a of due) {
    const s: any = await SurveyModel.findById(a.surveyId);
    await surveys.review(String(a.researcherId), String(a._id), 'approved', { by: 'auto' });
    await tellParticipant(a, s, 'approved');
    n++;
  }
  const bookings: any[] = await BookingModel.find({ status: 'booked', end: { $lte: cutoff } }).limit(500);
  for (const b of bookings) {
    await markHappened(String(b.researcherId), String(b._id), 'auto');
    n++;
  }
  return n;
}

/** One email per researcher: work that will be approved automatically in 2 days, and sessions not marked a day later. */
export async function sendReviewReminders(now = new Date()) {
  const old: any[] = await SurveyActionModel.find({ status: 'submitted', submittedAt: { $lte: new Date(now.getTime() - REMIND_AFTER_DAYS * DAY) }, reviewReminded: { $exists: false } });
  const unmarked: any[] = await BookingModel.find({ status: 'booked', end: { $lte: new Date(now.getTime() - DAY) }, attendanceReminded: { $exists: false } });
  // One email per person: each study's reminder goes to whoever made it (Stage 9), unless they turned it off.
  const studies: any[] = await SurveyModel.find({ _id: { $in: [...old, ...unmarked].map((x) => x.surveyId) } }).select('plan.basics.title surveyName userId createdBy');
  const names = new Map(studies.map((s: any) => [String(s._id), titleOf(s)]));
  const contactOf = new Map<string, string | null>();
  for (const s of studies) contactOf.set(String(s._id), await studyContact(s, 'review'));
  const byResearcher = new Map<string, { reviews: Map<string, number>; sessions: Set<string> }>();
  const slot = (sid: string) => {
    const to = contactOf.get(sid);
    if (!to) return null;
    return byResearcher.get(to) || byResearcher.set(to, { reviews: new Map(), sessions: new Set() }).get(to)!;
  };
  for (const a of old) { const x = slot(String(a.surveyId)); x?.reviews.set(String(a.surveyId), (x.reviews.get(String(a.surveyId)) || 0) + 1); }
  for (const b of unmarked) slot(String(b.surveyId))?.sessions.add(String(b.surveyId));
  for (const [to, x] of byResearcher) {
    const lines = [
      ...[...x.reviews].map(([sid, n]) => `- ${names.get(sid)}: ${n} to review. They're approved automatically in 2 days, which pays them.`),
      ...[...x.sessions].map((sid) => `- ${names.get(sid)}: mark who joined. Unmarked bookings count as attended after ${AUTO_APPROVE_DAYS} days.`),
    ];
    await sendMail({ to, subject: 'Work waiting for your review', text: `${lines.join('\n')}\n\nReview it here: ${appUrl('/dashboard/researcher/survey-actions')}` });
  }
  if (old.length) await SurveyActionModel.updateMany({ _id: { $in: old.map((a) => a._id) } }, { $set: { reviewReminded: now } });
  if (unmarked.length) await BookingModel.updateMany({ _id: { $in: unmarked.map((b) => b._id) } }, { $set: { attendanceReminded: now } });
  return byResearcher.size;
}
