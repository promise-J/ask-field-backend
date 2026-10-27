import { isValidObjectId, Types } from 'mongoose';
import AppError from '../../error-helpers/appError';
import { env } from '../../config/env';
import { sendMail } from '../../utils/mailer';
import { wantsMessageEmails } from '../account/settings.service';
import { SurveyActionModel, SurveyModel } from '../survey/survey.model';
import { ParticipantModel } from '../user/models/participant.model';
import { ResearcherModel } from '../user/models/researcher.model';
import { MessageModel } from './message.model';
import { studyContact } from '../team/contact';

/**
 * Stage 6: messages between a researcher and the people taking part in one study.
 * Nobody sees the other side's email or phone; participants appear by their study code (P-07).
 */

const TAKING_PART = ['in-progress', 'submitted', 'approved', 'no-show'];
const EVERYONE = ['in-progress', 'submitted', 'approved'];
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+?\d[\s().-]?){10,}/;
const titleOf = (s: any) => s?.plan?.basics?.title || s?.surveyName || 'your study';
const appUrl = (path: string) => `${env.FRONTEND_URL.replace(/\/$/, '')}${path}`;

/** Keeps contact details inside joinStudy, so both sides stay protected. Links (for meetings) are fine. */
export function checkBody(body: string) {
  const text = String(body || '').trim();
  if (!text) throw new AppError('Write a message first.', 400);
  if (text.length > 4000) throw new AppError('Keep messages under 4,000 characters.', 400);
  const withoutLinks = text.replace(/https?:\/\/\S+/g, '');
  if (EMAIL.test(withoutLinks) || PHONE.test(withoutLinks)) {
    throw new AppError('Please keep email addresses and phone numbers out of messages. Everything can happen here.', 400, 'contact_details');
  }
  return text;
}

async function ownedStudy(userId: string, id: string) {
  if (!isValidObjectId(id)) throw new AppError('Study not found.', 404);
  const s: any = await SurveyModel.findOne({ _id: id, userId });
  if (!s) throw new AppError('Study not found.', 404);
  return s;
}

/** Emails the other side, but only for the first unread message, so a burst doesn't become ten emails. */
async function notify(m: any, s: any) {
  const earlierUnread = await MessageModel.exists({ _id: { $ne: m._id }, surveyId: m.surveyId, participantId: m.participantId, from: m.from, readAt: { $exists: false } });
  if (earlierUnread) return;
  if (m.from === 'researcher') {
    // Participant Stage 7: they can turn message emails off in Settings.
    const to = await wantsMessageEmails(m.participantId);
    if (to) await sendMail({ to, subject: `New message about "${titleOf(s)}"`, text: `${m.body}\n\nReply on joinStudy: ${appUrl(`/dashboard/participant/messages?study=${s._id}`)}` });
  } else {
    const to = await studyContact(s, 'messages');
    const a: any = await SurveyActionModel.findOne({ surveyId: s._id, participantId: m.participantId }).select('code');
    await sendMail({ to: to as string, subject: `${a?.code || 'A participant'} replied about "${titleOf(s)}"`, text: `${m.body}\n\nReply on joinStudy: ${appUrl(`/dashboard/researcher/studies/${s._id}?tab=messages&p=${m.participantId}`)}` });
  }
}

// ---------------------------------------------------------------- researcher side

/** One row per participant who has a conversation on this study, newest first. */
export async function threadsForStudy(userId: string, id: string) {
  const s = await ownedStudy(userId, id);
  return threadRows([s]);
}

/** Every conversation across the researcher's studies (the Messages page). */
export async function researcherInbox(userId: string) {
  const ids = await MessageModel.distinct('surveyId', { researcherId: userId });
  const studies = await SurveyModel.find({ _id: { $in: ids }, userId });
  const threads = await threadRows(studies);
  return { threads, unread: threads.reduce((t, x) => t + x.unread, 0) };
}

async function threadRows(studies: any[]) {
  if (!studies.length) return [];
  const byId = new Map(studies.map((s) => [String(s._id), s]));
  const msgs: any[] = await MessageModel.find({ surveyId: { $in: studies.map((s) => s._id) } }).sort({ createdAt: 1 });
  const threads = new Map<string, any>();
  for (const m of msgs) {
    const key = `${m.surveyId}:${m.participantId}`;
    const t = threads.get(key) || { surveyId: String(m.surveyId), participantId: String(m.participantId), count: 0, unread: 0 };
    t.count++;
    if (m.from === 'participant' && !m.readAt) t.unread++;
    t.last = { from: m.from, body: m.body.slice(0, 160), at: m.createdAt, broadcast: m.broadcast };
    threads.set(key, t);
  }
  const actions: any[] = await SurveyActionModel.find({ surveyId: { $in: studies.map((s) => s._id) } }).select('surveyId participantId code status');
  const codeOf = new Map(actions.map((a) => [`${a.surveyId}:${a.participantId}`, a]));
  return [...threads.values()]
    .map((t) => ({ ...t, study: titleOf(byId.get(t.surveyId)), code: codeOf.get(`${t.surveyId}:${t.participantId}`)?.code || 'P-?', status: codeOf.get(`${t.surveyId}:${t.participantId}`)?.status || '' }))
    .sort((a, b) => new Date(b.last.at).getTime() - new Date(a.last.at).getTime());
}

/** One conversation. Opening it marks the participant's messages read. */
export async function researcherThread(userId: string, id: string, participantId: string) {
  const s = await ownedStudy(userId, id);
  if (!isValidObjectId(participantId)) throw new AppError('Participant not found.', 404);
  const a: any = await SurveyActionModel.findOne({ surveyId: s._id, participantId }).select('code status');
  if (!a) throw new AppError('This person isn’t taking part in this study.', 404);
  await MessageModel.updateMany({ surveyId: s._id, participantId, from: 'participant', readAt: { $exists: false } }, { $set: { readAt: new Date() } });
  const messages = await MessageModel.find({ surveyId: s._id, participantId }).sort({ createdAt: 1 });
  return { surveyId: String(s._id), participantId, code: a.code || 'P-?', status: a.status, study: titleOf(s), messages: messages.map((m) => m.toJSON()) };
}

/** To one participant, or to everyone taking part right now (stored once per person). */
export async function researcherSend(userId: string, id: string, input: { to: string; body: string }) {
  const s = await ownedStudy(userId, id);
  const body = checkBody(input.body);
  let recipients: Types.ObjectId[];
  if (input.to === 'everyone') {
    recipients = (await SurveyActionModel.find({ surveyId: s._id, status: { $in: EVERYONE } }).select('participantId')).map((a: any) => a.participantId);
    if (!recipients.length) throw new AppError('No one is taking part yet.', 409, 'no_recipients');
  } else {
    if (!isValidObjectId(input.to)) throw new AppError('Participant not found.', 404);
    const a: any = await SurveyActionModel.findOne({ surveyId: s._id, participantId: input.to, status: { $in: TAKING_PART } });
    if (!a) throw new AppError('This person isn’t taking part in this study.', 404);
    recipients = [a.participantId];
  }
  const broadcast = input.to === 'everyone';
  const created = await MessageModel.insertMany(recipients.map((participantId) => ({ surveyId: s._id, researcherId: s.userId, participantId, from: 'researcher', body, broadcast })));
  for (const m of created) await notify(m, s);
  return { sent: created.length, broadcast, message: broadcast ? null : created[0].toJSON() };
}

// ---------------------------------------------------------------- participant side

/** One row per study the participant has messages on. */
export async function participantInbox(participantId: string) {
  const msgs: any[] = await MessageModel.find({ participantId }).sort({ createdAt: 1 });
  const studies = new Map((await SurveyModel.find({ _id: { $in: [...new Set(msgs.map((m) => String(m.surveyId)))] } })).map((s: any) => [String(s._id), s]));
  const threads = new Map<string, any>();
  for (const m of msgs) {
    const id = String(m.surveyId);
    const t = threads.get(id) || { surveyId: id, study: titleOf(studies.get(id)), count: 0, unread: 0 };
    t.count++;
    if (m.from === 'researcher' && !m.readAt) t.unread++;
    t.last = { from: m.from, body: m.body.slice(0, 160), at: m.createdAt };
    threads.set(id, t);
  }
  const list = [...threads.values()].sort((a, b) => new Date(b.last.at).getTime() - new Date(a.last.at).getTime());
  return { threads: list, unread: list.reduce((t, x) => t + x.unread, 0) };
}

async function participantStudy(participantId: string, surveyId: string) {
  if (!isValidObjectId(surveyId)) throw new AppError('Study not found.', 404);
  const [s, a]: any[] = await Promise.all([SurveyModel.findById(surveyId), SurveyActionModel.findOne({ surveyId, participantId }).select('status code')]);
  if (!s || !a || a.status === 'screened-out') throw new AppError('Study not found.', 404);
  return { s, a };
}

export async function participantThread(participantId: string, surveyId: string) {
  const { s, a } = await participantStudy(participantId, surveyId);
  await MessageModel.updateMany({ surveyId, participantId, from: 'researcher', readAt: { $exists: false } }, { $set: { readAt: new Date() } });
  const [messages, r]: any[] = await Promise.all([MessageModel.find({ surveyId, participantId }).sort({ createdAt: 1 }), ResearcherModel.findById(s.userId).select('firstName lastName organizationName')]);
  // Participants see the researcher's name and organisation, never their email.
  return { surveyId, study: titleOf(s), code: a.code || 'P-?', researcher: { name: [r?.firstName, r?.lastName].filter(Boolean).join(' '), organization: r?.organizationName || '' }, canReply: true, messages: messages.map((m: any) => m.toJSON()) };
}

export async function participantSend(participantId: string, surveyId: string, input: { body: string }) {
  const { s } = await participantStudy(participantId, surveyId);
  const body = checkBody(input.body);
  const m = await MessageModel.create({ surveyId: s._id, researcherId: s.userId, participantId, from: 'participant', body });
  await notify(m, s);
  return m.toJSON();
}
