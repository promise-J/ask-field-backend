import { isValidObjectId, Types } from 'mongoose';
import AppError from '../../error-helpers/appError';
import { env } from '../../config/env';
import logger from '../../config/logger';
import { sendMail } from '../../utils/mailer';
import { SurveyActionModel, SurveyModel } from '../survey/survey.model';
import { studyContact } from '../team/contact';
import { load } from './settings.service';
import { HELP_TOPICS, REPORT_REASONS, SERIOUS_REASONS, SupportCaseModel } from './models';

/** Participant Stage 7, canvas 7.3 (contact joinStudy) and 7.4 (report a study). */

export type HelpTopic = (typeof HELP_TOPICS)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];
/** Reports from this many different people (for bank details, money or harm) pause a study until joinStudy checks. */
export const PAUSE_AFTER_REPORTS = 3;

export const TOPIC_LABELS: Record<HelpTopic, string> = {
  account: 'My account',
  money: 'Money and cash-outs',
  verification: 'Getting verified',
  study: 'A study',
  other: 'Something else',
};
export const REASON_LABELS: Record<ReportReason, string> = {
  'asks-details': 'Asks for bank, card or ID details',
  'asks-money': 'Asks me to pay, or to move off joinStudy',
  harmful: 'Offensive or harmful',
  'not-as-described': 'Not what the study page said',
  'broken-link': 'The link doesn’t work',
  other: 'Something else',
};

const supportInbox = () => env.SUPPORT_INBOX || env.LEADS_INBOX;
const trustInbox = () => env.TRUST_INBOX || env.LEADS_INBOX;
const titleOf = (s: any) => s?.plan?.basics?.title || s?.surveyName || 'Study';
const site = (path: string) => `${env.FRONTEND_URL.replace(/\/$/, '')}${path}`;

async function newReference(kind: 'help' | 'report') {
  const prefix = kind === 'help' ? 'JS-HP-' : 'JS-RP-';
  const n = await SupportCaseModel.countDocuments({ kind });
  return (bump: number) => `${prefix}${String(n + 1 + bump).padStart(6, '0')}`;
}

/** Creates a case with the next reference; retries if two arrive at once. */
async function createCase(kind: 'help' | 'report', data: Record<string, unknown>) {
  const ref = await newReference(kind);
  for (let i = 0; i < 5; i++) {
    try {
      return await SupportCaseModel.create({ kind, reference: ref(i), ...data });
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
    }
  }
  throw new AppError('Please try again.', 503);
}

/** Canvas 7.3: "Contact joinStudy". Answered within 2 working days, by email. */
export async function contact(participantId: string, input: { topic: HelpTopic; message: string; surveyId?: string }) {
  const p = await load(participantId);
  const surveyId = input.surveyId && isValidObjectId(input.surveyId) ? new Types.ObjectId(input.surveyId) : undefined;
  const c: any = await createCase('help', { participantId: p._id, topic: input.topic, message: input.message.trim(), surveyId });
  const study = surveyId ? titleOf(await SurveyModel.findById(surveyId).select('plan.basics.title surveyName')) : null;
  await sendMail({
    to: supportInbox(),
    subject: `${c.reference} · ${TOPIC_LABELS[input.topic]}${study ? ` · ${study}` : ''}`,
    text: `From ${p.firstName} ${p.lastName} <${p.email}> (participant ${p._id}, ${p.country || 'no country'}).\n\n${c.message}\n\nReply to them by email within 2 working days. Close it with: npm run review-reports -- close ${c.reference} "What we did"`,
  });
  await sendMail({
    to: p.email,
    subject: `We’ve got your message (${c.reference})`,
    text: `Hi ${p.firstName},\n\nThanks for writing to joinStudy. We answer within 2 working days, by email. Your reference is ${c.reference}.\n\nYou wrote:\n${c.message}`,
  });
  return { reference: c.reference, answerWithinDays: 2 };
}

/** The studies they could report: ones they've seen a page for or started. */
async function reportable(participantId: string, surveyId: string) {
  if (!isValidObjectId(surveyId)) throw new AppError('Study not found.', 404);
  const s: any = await SurveyModel.findById(surveyId).select('status userId createdBy plan.basics.title surveyName paused reportHold');
  if (!s || !['published', 'closed'].includes(s.status)) throw new AppError('Study not found.', 404);
  return s;
}

export async function reportForm(participantId: string, surveyId: string) {
  const s = await reportable(participantId, surveyId);
  const mine: any = await SupportCaseModel.findOne({ kind: 'report', surveyId: s._id, participantId }).sort({ createdAt: -1 });
  return {
    surveyId: String(s._id),
    title: titleOf(s),
    reasons: REPORT_REASONS.map((value) => ({ value, label: REASON_LABELS[value] })),
    already: mine ? { reference: mine.reference, reason: mine.reason, at: mine.createdAt } : null,
  };
}

/**
 * Canvas 7.4: report a study. Every report reaches joinStudy (the trust inbox, within 1 working day). The researcher
 * isn't told who. Reports about bank details, money or harm from 3 different people pause the study until we check.
 */
export async function report(participantId: string, surveyId: string, input: { reason: ReportReason; message?: string }) {
  const p = await load(participantId);
  const s = await reportable(participantId, surveyId);
  const message = (input.message || '').trim();
  if (input.reason === 'other' && message.length < 10) throw new AppError('Tell us what’s wrong, in a sentence or two.', 400, 'message_needed');
  // One report per person per study: a second one updates the first.
  const existing: any = await SupportCaseModel.findOne({ kind: 'report', surveyId: s._id, participantId: p._id, status: 'open' });
  let c: any;
  if (existing) {
    existing.set({ reason: input.reason, message: message || existing.message });
    c = await existing.save();
  } else {
    c = await createCase('report', { participantId: p._id, surveyId: s._id, reason: input.reason, message });
  }
  const a: any = await SurveyActionModel.findOne({ surveyId: s._id, participantId: p._id }).select('code status');
  const paused = await maybePause(s);
  await sendMail({
    to: trustInbox(),
    subject: `${paused ? 'PAUSED · ' : ''}${c.reference} · ${REASON_LABELS[input.reason]} · ${titleOf(s)}`,
    text: [
      `Study: ${titleOf(s)} (${s._id}), ${s.status}${paused ? ', now paused after several reports' : ''}.`,
      `Reported by participant ${p._id}${a?.code ? ` (${a.code}, ${a.status})` : ' (not started)'}.`,
      `Reason: ${REASON_LABELS[input.reason]}`,
      message ? `\n${message}` : '',
      `\nLook within 1 working day. npm run review-reports -- list | release <studyId> "note" | close ${c.reference} "note"`,
    ].join('\n'),
  });
  return { reference: c.reference, paused, safety: ['asks-details', 'asks-money'].includes(input.reason) };
}

/** Pauses a live study once enough different people report it for a serious reason. */
async function maybePause(s: any) {
  if (s.status !== 'published' || s.reportHold?.at) return false;
  const people = await SupportCaseModel.distinct('participantId', { kind: 'report', surveyId: s._id, status: 'open', reason: { $in: SERIOUS_REASONS } });
  if (people.length < PAUSE_AFTER_REPORTS) return false;
  const r = await SurveyModel.updateOne({ _id: s._id, 'reportHold.at': { $exists: false } }, { $set: { paused: true, reportHold: { at: new Date(), reports: people.length } } });
  if (!r.modifiedCount) return false;
  try {
    const to = await studyContact(s); // always sent, whatever their email choices
    if (to) {
      await sendMail({
        to: to as string,
        subject: `"${titleOf(s)}" is paused while joinStudy checks it`,
        text: `Several participants reported "${titleOf(s)}", so we've paused it: no one new can start. People already taking part can finish.\n\nWe'll look within 1 working day and email you. Studies must never ask for bank, card or ID details, ask people to pay, or move them off joinStudy.\n\n${site(`/dashboard/researcher/studies/${s._id}`)}`,
      });
    }
  } catch (err) {
    logger.error({ err }, 'Could not email the researcher about a report pause');
  }
  return true;
}

// ---------------------------------------------------------------- joinStudy's side (script, until there's an admin screen)

export async function openCases() {
  const list: any[] = await SupportCaseModel.find({ status: 'open' }).sort({ createdAt: 1 }).limit(500);
  const titles = new Map((await SurveyModel.find({ _id: { $in: list.map((c) => c.surveyId).filter(Boolean) } }).select('plan.basics.title surveyName reportHold')).map((s: any) => [String(s._id), s]));
  return list.map((c) => ({
    reference: c.reference,
    kind: c.kind,
    what: c.kind === 'help' ? TOPIC_LABELS[c.topic as HelpTopic] : REASON_LABELS[c.reason as ReportReason],
    study: c.surveyId ? `${titleOf(titles.get(String(c.surveyId)))} (${c.surveyId})${titles.get(String(c.surveyId))?.reportHold?.at ? ' PAUSED' : ''}` : '',
    at: c.createdAt,
    message: c.message,
  }));
}

export async function closeCase(reference: string, note: string) {
  const c: any = await SupportCaseModel.findOne({ reference });
  if (!c) throw new AppError(`No case ${reference}.`, 404);
  c.set({ status: 'closed', resolution: note, resolvedAt: new Date() });
  await c.save();
  return { reference, status: 'closed' };
}

/** After checking a paused study: lift the pause and close its reports. (To stop it, close it as its researcher would.) */
export async function releaseStudy(surveyId: string, note: string) {
  const s: any = await SurveyModel.findById(surveyId);
  if (!s) throw new AppError('Study not found.', 404);
  s.paused = false;
  s.reportHold = undefined;
  await s.save();
  const r = await SupportCaseModel.updateMany({ kind: 'report', surveyId: s._id, status: 'open' }, { $set: { status: 'closed', resolution: note, resolvedAt: new Date() } });
  const to = await studyContact(s); // always sent, whatever their email choices
  if (to) await sendMail({ to: to as string, subject: `"${titleOf(s)}" is live again`, text: `We've checked "${titleOf(s)}" and lifted the pause. ${note}` });
  return { surveyId, released: true, reportsClosed: r.modifiedCount };
}
