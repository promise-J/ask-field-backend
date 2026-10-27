import { isValidObjectId } from 'mongoose';
import AppError from '../../error-helpers/appError';
import { env } from '../../config/env';
import { sendMail } from '../../utils/mailer';
import { SurveyActionModel, SurveyModel } from '../survey/survey.model';
import { SurveyService, isExpired } from '../survey/survey.service';
import { ParticipantModel } from '../user/models/participant.model';
import { ResearcherModel } from '../user/models/researcher.model';
import { MessageModel } from '../run/message.model';
import { BookingModel } from '../run/booking.model';
import { studyContact } from '../team/contact';
import { autoApproveAt, REASONS, type Reason } from '../review/review.service';

/**
 * Participant Stage 5: after a study (canvas 5.1–5.4).
 * My studies, the reason for a "not approved" decision, one question about it, the researcher's answer,
 * and joinStudy looking when the researcher doesn't answer.
 */

const DAY = 864e5;
export const ASK_WITHIN_DAYS = 14;
export const ANSWER_WITHIN_DAYS = 7;
export const APPEAL_WHYS = ['did-tasks', 'did-checks', 'eligible', 'other'] as const;
export type AppealWhy = (typeof APPEAL_WHYS)[number];
export const WHY_LABELS: Record<AppealWhy, string> = {
  'did-tasks': 'I did everything the study asked',
  'did-checks': 'I did the attention checks',
  eligible: 'I am who the study is for',
  other: 'Something else',
};

const surveys = new SurveyService();
const site = () => env.FRONTEND_URL.replace(/\/$/, '');
const titleOf = (s: any) => s?.plan?.basics?.title || s?.surveyName || 'a study';
const methodOf = (s: any) => s?.method || (s?.surveyType === 'aiTaskBuilder' ? 'ai-evaluation' : 'survey');
const round = (n: number) => Math.round(n * 100) / 100;
const reviewInbox = () => env.REVIEW_INBOX || env.LEADS_INBOX;

export type Bucket = 'in-progress' | 'waiting' | 'paid' | 'not-approved' | 'ended';
function bucketOf(a: any, now = new Date()): Bucket | null {
  const st = isExpired(a, now) ? 'timed-out' : a.status;
  if (st === 'in-progress') return 'in-progress';
  if (st === 'submitted') return 'waiting';
  if (st === 'approved') return 'paid';
  if (st === 'rejected') return 'not-approved';
  if (st === 'left' || st === 'timed-out' || st === 'no-show') return 'ended';
  return null; // screened out: they never took part
}

const askUntil = (a: any) => (a.reviewedAt ? new Date(new Date(a.reviewedAt).getTime() + ASK_WITHIN_DAYS * DAY) : null);
const answerBy = (a: any) => (a.appeal?.askedAt ? new Date(new Date(a.appeal.askedAt).getTime() + ANSWER_WITHIN_DAYS * DAY) : null);

/** Canvas 5.1: every study they started, newest first. */
export async function myStudies(participantId: string, now = new Date()) {
  const actions: any[] = await SurveyActionModel.find({ participantId }).sort({ updatedAt: -1 }).limit(300);
  const studies = new Map(
    (await SurveyModel.find({ _id: { $in: actions.map((a) => a.surveyId) } }).select('plan.basics.title surveyName method surveyType status')).map((s: any) => [String(s._id), s])
  );
  const bookings: any[] = await BookingModel.find({ participantId, status: 'booked', end: { $gte: now } }).select('surveyId start');
  const bookingOf = new Map(bookings.map((b) => [String(b.surveyId), b.start]));
  const rows = actions
    .map((a) => {
      const s = studies.get(String(a.surveyId));
      const bucket = bucketOf(a, now);
      if (!s || !bucket) return null;
      const until = askUntil(a);
      return {
        surveyId: String(a.surveyId),
        title: titleOf(s),
        method: methodOf(s),
        bucket,
        status: isExpired(a, now) ? 'timed-out' : a.status,
        amount: round(Number(a.amount) || 0),
        currency: a.currency || env.DEFAULT_CURRENCY,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt || null,
        decidedAt: a.reviewedAt || null,
        heldUntil: bucket === 'in-progress' ? a.heldUntil || null : null,
        bookedFor: bookingOf.get(String(a.surveyId)) || null,
        autoApproveAt: bucket === 'waiting' && a.submittedAt ? autoApproveAt(a.submittedAt) : null,
        askUntil: bucket === 'not-approved' && !a.appeal?.status && until && until > now ? until : null,
        appeal: a.appeal?.status || null,
        changed: bucket === 'paid' && ['approved', 'overturned'].includes(a.appeal?.status),
      };
    })
    .filter(Boolean) as any[];
  const counts = { all: rows.length } as Record<string, number>;
  for (const r of rows) counts[r.bucket] = (counts[r.bucket] || 0) + 1;
  return { rows, counts };
}

async function mine(participantId: string, surveyId: string) {
  if (!isValidObjectId(surveyId)) throw new AppError('Study not found.', 404);
  const [a, s]: any[] = await Promise.all([SurveyActionModel.findOne({ participantId, surveyId }), SurveyModel.findById(surveyId)]);
  if (!a || !s || a.status === 'screened-out') throw new AppError('Study not found.', 404);
  return { a, s };
}

/** Canvas 5.2: the decision, its reason and note, the question and its answer, and what they can do next. */
export async function decision(participantId: string, surveyId: string, now = new Date()) {
  const { a, s } = await mine(participantId, surveyId);
  const r: any = await ResearcherModel.findById(s.userId).select('firstName lastName organizationName');
  const until = askUntil(a);
  const by = answerBy(a);
  const ap = a.appeal?.status ? a.appeal : null;
  const reason = (a.review?.reason as Reason) || null;
  return {
    surveyId,
    title: titleOf(s),
    method: methodOf(s),
    code: a.code || 'P-?',
    researcher: { name: [r?.firstName, r?.lastName].filter(Boolean).join(' '), organization: r?.organizationName || '' },
    status: a.status,
    bucket: bucketOf(a, now),
    amount: round(Number(a.amount) || 0),
    currency: a.currency || env.DEFAULT_CURRENCY,
    decidedAt: a.reviewedAt || null,
    decidedBy: a.review?.by || null,
    reason: a.status === 'rejected' || ap ? (reason ? { key: reason, text: REASONS[reason]?.seen || '' } : null) : null,
    note: a.review?.note || '',
    autoApproveAt: a.status === 'submitted' && a.submittedAt ? autoApproveAt(a.submittedAt) : null,
    askUntil: until,
    appeal: ap
      ? {
          status: ap.status,
          why: ap.why,
          whyLabel: WHY_LABELS[ap.why as AppealWhy] || '',
          message: ap.message,
          askedAt: ap.askedAt,
          answer: ap.answer || '',
          answeredAt: ap.answeredAt || null,
          answerBy: by,
          escalatedAt: ap.escalatedAt || null,
          resolution: ap.resolution || '',
          resolvedAt: ap.resolvedAt || null,
        }
      : null,
    canAsk: a.status === 'rejected' && !ap && !!until && until > now,
    canEscalate: a.status === 'rejected' && !!ap && (ap.status === 'kept' || (ap.status === 'open' && !!by && by <= now)),
  };
}

/** Canvas 5.3: one question per study, within 14 days of the decision. */
export async function ask(participantId: string, surveyId: string, input: { why: AppealWhy; message: string }, now = new Date()) {
  const { a, s } = await mine(participantId, surveyId);
  if (a.status !== 'rejected') throw new AppError('You can only ask about a study that wasn’t approved.', 409, 'not_rejected');
  if (a.appeal?.status) throw new AppError('You’ve already asked about this decision. One question per study.', 409, 'already_asked');
  const until = askUntil(a);
  if (!until || until <= now) throw new AppError(`It’s more than ${ASK_WITHIN_DAYS} days since the decision, so it can’t be asked about now.`, 409, 'too_late');
  const message = String(input.message || '').trim();
  a.set('appeal', { why: input.why, message, askedAt: now, status: 'open' });
  await a.save();
  await MessageModel.create({ surveyId: s._id, researcherId: s.userId, participantId, from: 'participant', kind: 'appeal', body: `${WHY_LABELS[input.why]}. ${message}` });
  const to = await studyContact(s, 'review');
  await sendMail({
    to: to as string,
    subject: `${a.code || 'A participant'} asked about your decision on "${titleOf(s)}"`,
    text: `${a.code || 'A participant'} asked about the work you didn't approve on "${titleOf(s)}".\n\n"${WHY_LABELS[input.why]}. ${message}"\n\nPlease answer by ${answerBy(a)!.toDateString()}: approve it, or keep your decision and reply. If there's no answer by then, joinStudy will look at it.\n\n${site()}/dashboard/researcher/studies/${s._id}?tab=review`,
  });
  return decision(participantId, surveyId, now);
}

/** "Ask joinStudy to look at it": after 7 days with no answer, or when the researcher kept their decision. */
export async function escalate(participantId: string, surveyId: string, now = new Date()) {
  const view = await decision(participantId, surveyId, now);
  if (!view.canEscalate) {
    throw new AppError(
      view.appeal?.status === 'open' ? `The researcher has until ${view.appeal.answerBy?.toDateString()} to answer first.` : 'This decision can’t be sent to joinStudy.',
      409,
      'cant_escalate'
    );
  }
  const { a, s } = await mine(participantId, surveyId);
  a.set('appeal.status', 'escalated');
  a.set('appeal.escalatedAt', now);
  await a.save();
  await sendMail({
    to: reviewInbox(),
    subject: `Decision to review: ${a.code} on "${titleOf(s)}"`,
    text: [
      `Study: ${titleOf(s)} (${s._id})`,
      `Attempt: ${a._id} (${a.code})`,
      `Researcher's reason: ${REASONS[a.review?.reason as Reason]?.label || '—'}${a.review?.note ? ` · "${a.review.note}"` : ''}`,
      `Participant: ${WHY_LABELS[a.appeal.why as AppealWhy]}. ${a.appeal.message}`,
      `Researcher's answer: ${a.appeal.answer || '(none in 7 days)'}`,
      '',
      'Decide within 5 working days:',
      `  npm run review-appeal -- overturn ${a._id} "why"   (approves it and charges the study)`,
      `  npm run review-appeal -- uphold ${a._id} "why"`,
    ].join('\n'),
  });
  return decision(participantId, surveyId, now);
}

async function tellParticipant(a: any, s: any, subject: string, text: string) {
  const p: any = await ParticipantModel.findById(a.participantId).select('email');
  if (p?.email) await sendMail({ to: p.email, subject, text: `${text}\n\n${site()}/dashboard/participant/my-studies/${s._id}` });
}

/** Canvas 5.4: the researcher approves it after all, or keeps the decision with a reply. */
export async function answer(userId: string, surveyId: string, actionId: string, input: { decision: 'approve' | 'keep'; reply?: string }) {
  if (!isValidObjectId(surveyId) || !isValidObjectId(actionId)) throw new AppError('Not found.', 404);
  const s: any = await SurveyModel.findOne({ _id: surveyId, userId });
  if (!s) throw new AppError('Study not found.', 404);
  const a: any = await SurveyActionModel.findOne({ _id: actionId, surveyId });
  if (!a || a.appeal?.status !== 'open') throw new AppError('There’s no open question about this decision.', 409, 'no_question');
  const reply = String(input.reply || '').trim();
  if (input.decision === 'keep' && reply.length < 10) throw new AppError('Explain why the decision stands. The participant sees it.', 400, 'reply_required');
  if (input.decision === 'approve') await approveAfterAll(a, 'approved');
  a.set('appeal.status', input.decision === 'approve' ? 'approved' : 'kept');
  a.set('appeal.answer', reply);
  a.set('appeal.answeredAt', new Date());
  await a.save();
  if (reply) await MessageModel.create({ surveyId: s._id, researcherId: s.userId, participantId: a.participantId, from: 'researcher', kind: 'appeal-answer', body: reply });
  if (input.decision === 'approve') {
    await tellParticipant(a, s, `Approved after all: ${titleOf(s)}`, `The researcher changed their decision on "${titleOf(s)}". ${a.currency} ${Number(a.amount || 0).toFixed(2)} is in your joinStudy balance.${reply ? `\n\nTheir note: ${reply}` : ''}`);
  } else {
    await tellParticipant(a, s, `The researcher answered: ${titleOf(s)}`, `The researcher kept their decision on "${titleOf(s)}".\n\nTheir answer: ${reply}\n\nIf you still think it's wrong, you can ask joinStudy to look at it.`);
  }
  return { status: a.appeal.status };
}

/** Rejected → approved: pays the participant and charges the study, exactly like a normal approval. */
async function approveAfterAll(a: any, by: 'approved' | 'overturned') {
  if (a.status !== 'rejected') return;
  a.status = 'submitted';
  await a.save();
  await surveys.review(String(a.researcherId), String(a._id), 'approved', { by: 'researcher', note: by === 'overturned' ? 'Approved by joinStudy after review' : a.review?.note });
  const fresh: any = await SurveyActionModel.findById(a._id);
  a.status = fresh.status;
  a.reviewedAt = fresh.reviewedAt;
  a.set('review', fresh.review);
}

/** joinStudy's decision on an escalated question (scripts/review-appeal.ts until there's an admin screen). */
export async function resolve(actionId: string, outcome: 'overturn' | 'uphold', note: string) {
  if (!isValidObjectId(actionId)) throw new AppError('Not found.', 404);
  const a: any = await SurveyActionModel.findById(actionId);
  if (!a || a.appeal?.status !== 'escalated') throw new AppError('That isn’t waiting for joinStudy.', 409);
  const s: any = await SurveyModel.findById(a.surveyId);
  if (outcome === 'overturn') await approveAfterAll(a, 'overturned');
  a.set('appeal.status', outcome === 'overturn' ? 'overturned' : 'upheld');
  a.set('appeal.resolution', note);
  a.set('appeal.resolvedAt', new Date());
  await a.save();
  if (outcome === 'overturn') {
    await tellParticipant(a, s, `Approved after joinStudy's review: ${titleOf(s)}`, `We looked at "${titleOf(s)}" and found the work was done as the study asked. ${a.currency} ${Number(a.amount || 0).toFixed(2)} is in your joinStudy balance.\n\n${note}`);
    const to = await studyContact(s, 'review');
    await sendMail({ to: to as string, subject: `joinStudy approved ${a.code} on "${titleOf(s)}"`, text: `${a.code} asked us to look at your decision. We found the work was done as the study asked, so we approved it and charged the study as usual.\n\n${note}` });
  } else {
    await tellParticipant(a, s, `joinStudy's review: ${titleOf(s)}`, `We looked at "${titleOf(s)}" and the researcher's decision stands.\n\n${note}\n\nThis is final. It doesn't stop you taking other studies.`);
  }
  return { status: a.appeal.status };
}

export async function escalatedList() {
  return SurveyActionModel.find({ 'appeal.status': 'escalated' }).sort({ 'appeal.escalatedAt': 1 }).select('code surveyId appeal review');
}
