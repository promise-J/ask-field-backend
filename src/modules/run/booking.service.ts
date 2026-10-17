import { isValidObjectId, Types } from 'mongoose';
import AppError from '../../error-helpers/appError';
import { sendMail } from '../../utils/mailer';
import { env } from '../../config/env';
import { SurveyActionModel, SurveyModel } from '../survey/survey.model';
import { ParticipantModel } from '../user/models/participant.model';
import { ResearcherModel } from '../user/models/researcher.model';
import { SurveyService } from '../survey/survey.service';
import { BookingModel } from './booking.model';
import { daysBetween, formatIn, isTimeZone, zonedToUtc } from './time';

/**
 * Stage 6: interview and focus-group bookings. Times come from the plan (weekly free times or sessions),
 * participants book one, we remind both sides, and the researcher marks each one happened or didn't join.
 */

const BOOKING_METHODS = ['interview', 'focus-group'];
const NOTICE_MS = 12 * 3600e3; // book or move at least 12 hours ahead
const NO_SHOW_LIMIT = 2; // missed bookings in 30 days before invitations pause
const surveys = new SurveyService();

const methodOf = (s: any) => s.method || 'survey';

async function liveBookingStudy(id: string) {
  if (!isValidObjectId(id)) throw new AppError('Study not found.', 404);
  const s: any = await SurveyModel.findById(id);
  if (!s || !BOOKING_METHODS.includes(methodOf(s))) throw new AppError('This study doesn’t use bookings.', 404);
  return s;
}

/** Every bookable time for a study, with how many places are left at each. */
export async function openSlots(s: any, now = new Date()) {
  const setup = s.plan?.setup || {};
  const minutes = Number(setup.minutes) || 0;
  const taken = await BookingModel.find({ surveyId: s._id, status: { $in: ['booked', 'happened'] } }).select('start end');
  if (methodOf(s) === 'interview') {
    const tz = isTimeZone(setup.timeZone) ? setup.timeZone : 'UTC';
    const gap = (Number(setup.gapMinutes) || 0) * 60000;
    if (taken.length >= (Number(setup.count) || 0)) return [];
    const wanted = new Set<string>(setup.weekly || []);
    const out: { start: Date; end: Date; left: number }[] = [];
    for (const { day, weekday } of daysBetween(setup.from, setup.to)) {
      for (const k of wanted) {
        const [wd, time] = k.split(' ');
        if (wd !== weekday) continue;
        const start = zonedToUtc(day, time, tz);
        const end = new Date(start.getTime() + minutes * 60000);
        if (start.getTime() < now.getTime() + NOTICE_MS) continue;
        const clash = taken.some((b: any) => start.getTime() < b.end.getTime() + gap && end.getTime() + gap > b.start.getTime());
        if (!clash) out.push({ start, end, left: 1 });
      }
    }
    return out.sort((a, b) => a.start.getTime() - b.start.getTime());
  }
  // Focus groups: fixed sessions, each with room for the group plus extras.
  const capacity = (Number(setup.perGroup) || 0) + (Number(setup.extras) || 0);
  return (setup.sessions || [])
    .map((iso: string) => new Date(iso))
    .filter((start: Date) => start.getTime() >= now.getTime() + NOTICE_MS)
    .map((start: Date) => ({ start, end: new Date(start.getTime() + minutes * 60000), left: capacity - taken.filter((b: any) => b.start.getTime() === start.getTime()).length }))
    .filter((x: any) => x.left > 0)
    .sort((a: any, b: any) => a.start.getTime() - b.start.getTime());
}

/** The participant must have passed eligibility (and consent, where the study asks for it). */
async function participantAction(participantId: string, s: any) {
  const action: any = await SurveyActionModel.findOne({ surveyId: s._id, participantId });
  if (!action || action.status !== 'in-progress') throw new AppError('Check you can take part first.', 409, 'not_started');
  if (s.plan?.basics?.consent?.mode === 'joinstudy' && !action.consentedAt) throw new AppError('Please read and agree to the consent information first.', 400, 'consent_required');
  return action;
}

export async function slotsForParticipant(participantId: string, id: string) {
  const s = await liveBookingStudy(id);
  if (s.status !== 'published') throw new AppError('This study is no longer taking participants.', 403);
  await participantAction(participantId, s);
  const [mine, slots, r]: any[] = await Promise.all([
    BookingModel.findOne({ surveyId: s._id, participantId, status: 'booked' }),
    openSlots(s),
    ResearcherModel.findById(s.userId).select('organizationName institutionVerification.status'),
  ]);
  return {
    title: s.plan?.basics?.title || s.surveyName,
    method: methodOf(s),
    perPerson: Number(s.plan?.pay?.perPerson) || 0,
    currency: s.currency || env.DEFAULT_CURRENCY,
    organization: r?.organizationName || '',
    verified: r?.institutionVerification?.status === 'verified',
    minutes: Number(s.plan?.setup?.minutes) || 0,
    booking: mine ? participantBookingView(s, mine) : null,
    slots: slots.map((x: any) => ({ start: x.start.toISOString(), end: x.end.toISOString(), left: x.left })),
  };
}

function participantBookingView(s: any, b: any) {
  const setup = s.plan?.setup || {};
  return { ...b.toJSON(), videoUrl: b.videoUrl || (setup.videoMode === 'each' ? '' : setup.videoUrl || ''), title: s.plan?.basics?.title || s.surveyName, canChange: b.start.getTime() - Date.now() > NOTICE_MS };
}

export async function book(participantId: string, id: string, input: { start: string; timeZone?: string }) {
  const s = await liveBookingStudy(id);
  if (s.status !== 'published' || s.paused) throw new AppError('This study isn’t taking bookings right now.', 403);
  const action = await participantAction(participantId, s);
  if (await BookingModel.exists({ surveyId: s._id, participantId, status: 'booked' })) throw new AppError('You already have a booking for this study. Cancel it first to choose another time.', 409, 'already_booked');
  const since = new Date(Date.now() - 30 * 864e5);
  if ((await BookingModel.countDocuments({ participantId, status: 'noshow', start: { $gte: since } })) >= NO_SHOW_LIMIT) {
    throw new AppError('You missed two bookings in the last 30 days, so bookings are paused for you for now.', 403, 'too_many_no_shows');
  }
  const wanted = new Date(input.start).getTime();
  const slot = (await openSlots(s)).find((x: any) => x.start.getTime() === wanted);
  if (!slot) throw new AppError('That time was just taken. Choose another.', 409, 'slot_taken');
  const tz = input.timeZone && isTimeZone(input.timeZone) ? input.timeZone : 'Africa/Lagos';
  const b: any = await BookingModel.create({ surveyId: s._id, researcherId: s.userId, participantId, surveyActionId: action._id, start: slot.start, end: slot.end, participantTz: tz });
  const [p, r]: any[] = await Promise.all([ParticipantModel.findById(participantId).select('email firstName'), ResearcherModel.findById(s.userId).select('email')]);
  const title = s.plan?.basics?.title || s.surveyName;
  await sendMail({ to: p?.email, subject: `Booked: ${title}`, text: `You're booked for ${formatIn(slot.start, tz)} (your time). We'll remind you the day before and an hour before. You can move or cancel up to 12 hours before.` });
  await sendMail({ to: r?.email, subject: `New booking: ${action.code || 'a participant'} for "${title}"`, text: `${formatIn(slot.start, s.plan?.setup?.timeZone || 'UTC')} (your time).` });
  return participantBookingView(s, b);
}

export async function cancelBooking(participantId: string, bookingId: string) {
  if (!isValidObjectId(bookingId)) throw new AppError('Booking not found.', 404);
  const b: any = await BookingModel.findOne({ _id: bookingId, participantId, status: 'booked' });
  if (!b) throw new AppError('Booking not found.', 404);
  if (b.start.getTime() - Date.now() < NOTICE_MS) throw new AppError('It’s less than 12 hours away, so it can’t be changed now. Message the researcher if something came up.', 409, 'too_late');
  b.status = 'cancelled';
  await b.save();
  return { status: 'cancelled' };
}

export async function myBookings(participantId: string) {
  const list: any[] = await BookingModel.find({ participantId, status: 'booked', end: { $gte: new Date() } }).sort({ start: 1 });
  const studies = new Map((await SurveyModel.find({ _id: { $in: list.map((b) => b.surveyId) } })).map((s: any) => [String(s._id), s]));
  return list.map((b) => participantBookingView(studies.get(String(b.surveyId)), b));
}

// ---------------------------------------------------------------- researcher side

export async function bookingsForResearcher(userId: string, id: string) {
  const s = await liveBookingStudy(id);
  if (String(s.userId) !== String(userId)) throw new AppError('Study not found.', 404);
  const list: any[] = await BookingModel.find({ surveyId: s._id, status: { $ne: 'cancelled' } }).sort({ start: 1 });
  const actions = new Map((await SurveyActionModel.find({ _id: { $in: list.map((b) => b.surveyActionId) } }).select('code')).map((a: any) => [String(a._id), a.code]));
  const people = new Map((await ParticipantModel.find({ _id: { $in: list.map((b) => b.participantId) } }).select('profile.countryOfResidence')).map((p: any) => [String(p._id), p.profile?.countryOfResidence || '']));
  const open = await openSlots(s);
  const setup = s.plan?.setup || {};
  return {
    timeZone: setup.timeZone || 'UTC',
    videoMode: setup.videoMode || 'one',
    capacity: methodOf(s) === 'interview' ? Number(setup.count) || 0 : ((Number(setup.perGroup) || 0) + (Number(setup.extras) || 0)) * (setup.sessions || []).length,
    bookings: list.map((b) => ({ ...b.toJSON(), code: actions.get(String(b.surveyActionId)) || 'P-?', country: people.get(String(b.participantId)) || '' })),
    open: open.map((x: any) => ({ start: x.start.toISOString(), end: x.end.toISOString(), left: x.left })),
  };
}

async function ownedBooking(userId: string, bookingId: string) {
  if (!isValidObjectId(bookingId)) throw new AppError('Booking not found.', 404);
  const b: any = await BookingModel.findOne({ _id: bookingId, researcherId: userId });
  if (!b) throw new AppError('Booking not found.', 404);
  return b;
}

/** "Happened": the participant's work is submitted and approved, which pays them. */
export async function markHappened(userId: string, bookingId: string, by: 'researcher' | 'attendance' | 'auto' = 'researcher') {
  const b = await ownedBooking(userId, bookingId);
  if (b.status === 'happened') return b;
  if (b.status !== 'booked' && b.status !== 'noshow') throw new AppError('This booking was cancelled.', 409);
  if (b.start.getTime() > Date.now()) throw new AppError('You can mark it once the time has started.', 409, 'not_yet');
  const action: any = await SurveyActionModel.findById(b.surveyActionId);
  if (action.status === 'in-progress' || action.status === 'no-show') {
    action.status = 'in-progress';
    await action.save();
    await surveys.submit(String(b.participantId), String(action._id), 'booking');
  }
  await surveys.review(String(userId), String(action._id), 'approved', { by });
  b.status = 'happened';
  await b.save();
  return b;
}

/** "Didn't join": not charged, and the participant can't take part in this study any more. */
export async function markNoShow(userId: string, bookingId: string) {
  const b = await ownedBooking(userId, bookingId);
  if (b.status === 'noshow') return b;
  if (b.status !== 'booked') throw new AppError(`This booking is ${b.status}.`, 409);
  if (b.start.getTime() > Date.now()) throw new AppError('You can mark it once the time has started.', 409, 'not_yet');
  b.status = 'noshow';
  await b.save();
  await SurveyActionModel.updateOne({ _id: b.surveyActionId, status: 'in-progress' }, { $set: { status: 'no-show' } });
  return b;
}

export async function setBookingLink(userId: string, bookingId: string, url: string) {
  const b = await ownedBooking(userId, bookingId);
  if (!/^https?:\/\/\S+\.\S+/.test(url)) throw new AppError('Enter a full link, starting with https://', 400);
  b.videoUrl = url;
  await b.save();
  const p: any = await ParticipantModel.findById(b.participantId).select('email');
  await sendMail({ to: p?.email, subject: 'Your meeting link', text: `Join here at ${formatIn(b.start, b.participantTz)}: ${url}` });
  return b;
}

/** Cancels future bookings when a study closes early. */
export async function cancelFutureBookings(surveyId: Types.ObjectId | string) {
  const list: any[] = await BookingModel.find({ surveyId, status: 'booked', start: { $gt: new Date() } });
  for (const b of list) {
    b.status = 'cancelled';
    await b.save();
    const p: any = await ParticipantModel.findById(b.participantId).select('email');
    await sendMail({ to: p?.email, subject: 'Your booking was cancelled', text: `The researcher closed the study, so your booking on ${formatIn(b.start, b.participantTz)} is cancelled. Sorry for the change.` });
  }
  return list.length;
}

/** Reminders 24 hours and 1 hour before. Called every few minutes by the server. Safe to run twice. */
export async function sendDueReminders(now = new Date()) {
  const in24 = new Date(now.getTime() + 24 * 3600e3);
  const in1 = new Date(now.getTime() + 3600e3);
  let sent = 0;
  const day: any[] = await BookingModel.find({ status: 'booked', start: { $gt: in1, $lte: in24 }, reminded24: { $exists: false } });
  const hour: any[] = await BookingModel.find({ status: 'booked', start: { $gt: now, $lte: in1 }, reminded1: { $exists: false } });
  for (const [list, field, when] of [[day, 'reminded24', 'tomorrow'], [hour, 'reminded1', 'in an hour']] as const) {
    for (const b of list) {
      const [s, p]: any[] = await Promise.all([SurveyModel.findById(b.surveyId), ParticipantModel.findById(b.participantId).select('email')]);
      const link = b.videoUrl || (s?.plan?.setup?.videoMode === 'each' ? '' : s?.plan?.setup?.videoUrl || '');
      await sendMail({ to: p?.email, subject: `Reminder: ${s?.plan?.basics?.title || 'your joinStudy session'} ${when}`, text: `${formatIn(b.start, b.participantTz)} (your time).${link ? ` Join here: ${link}` : ' We’ll send the link soon.'}` });
      if (field === 'reminded1') {
        const r: any = await ResearcherModel.findById(b.researcherId).select('email');
        await sendMail({ to: r?.email, subject: 'Your session starts in an hour', text: `${formatIn(b.start, s?.plan?.setup?.timeZone || 'UTC')} (your time).${link ? '' : ' Add the meeting link for this booking.'}` });
      }
      b[field] = now;
      await b.save();
      sent++;
    }
  }
  return sent;
}
