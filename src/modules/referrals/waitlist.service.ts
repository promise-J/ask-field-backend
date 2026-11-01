import { config, env } from '../../config/env';
import logger from '../../config/logger';
import { sendMail } from '../../utils/mailer';
import { ParticipantModel } from '../user/models/participant.model';
import { ReferralModel } from './referral.model';

/**
 * The participant waitlist, one queue per country (PARTICIPANT_WAITLIST).
 *
 * Room in a country = WAITLIST_MIN_SEATS + WAITLIST_PLACES_FACTOR x open places in live studies there.
 * A new participant is active straight away while there's room and nobody is waiting; otherwise they wait.
 * Everyone who joined before the waitlist (no `access`) stays active.
 * Waiting people see no studies, get no study emails and can't start a study (verification/gate.ts).
 * The queue is ordered by score (invites), then by when they joined. Score: 1 per friend who signs up with
 * their link, 2 more when that friend finishes verification.
 */

const notClosed = { $or: [{ closedAt: { $exists: false } }, { closedAt: null }] };
export const countryOf = (p: any): string => p?.country || p?.profile?.countryOfResidence || '';
export const isWaiting = (p: any) => p?.access?.status === 'waiting';

async function openPlaces(now = new Date()) {
  const { openPlacesByCountry } = await import('../studies/studies.service');
  return openPlacesByCountry(now);
}

export async function roomIn(country: string, now = new Date()) {
  const open = (await openPlaces(now)).get(country) || 0;
  return config.waitlist.minSeats + config.waitlist.factor * open;
}

const activeIn = (country: string, exceptId?: unknown) =>
  ParticipantModel.countDocuments({ country, 'access.status': { $ne: 'waiting' }, ...notClosed, ...(exceptId ? { _id: { $ne: exceptId } } : {}) });

/** Called when a participant account is made (email or Google). */
export async function placeOnSignup(p: any, now = new Date()) {
  if (!config.waitlist.on || !p?._id) return;
  const country = countryOf(p);
  try {
    const [room, active, queue] = await Promise.all([roomIn(country, now), activeIn(country, p._id), ParticipantModel.exists({ country, 'access.status': 'waiting', _id: { $ne: p._id } })]);
    const access = active < room && !queue ? { status: 'active', since: now, admittedAt: now, score: 0 } : { status: 'waiting', since: now, score: 0 };
    await ParticipantModel.updateOne({ _id: p._id }, { $set: { access } });
    p.access = access;
    if (access.status === 'waiting') await refreshScore(String(p._id));
  } catch (error) {
    logger.error({ error }, 'Placing a participant on the waitlist failed');
  }
}

/** Recounts someone's invites (for the queue order). */
export async function refreshScore(participantId: string) {
  const rows: any[] = await ReferralModel.find({ type: 'participant', referrerId: participantId, status: { $ne: 'blocked' } }).select('status');
  const score = rows.reduce((t, r) => t + 1 + (r.status === 'qualified' ? 2 : 0), 0);
  await ParticipantModel.updateOne({ _id: participantId }, { $set: { 'access.score': score } });
  return score;
}

/** What the home page and the Invite page show about the queue. */
export async function waitlistOf(p: any) {
  if (!p || !isWaiting(p)) return { status: 'active' as const };
  const country = countryOf(p);
  const score = p.access?.score || 0;
  const since = p.access?.since || p.createdAt || new Date();
  const ahead = await ParticipantModel.countDocuments({
    country,
    'access.status': 'waiting',
    ...notClosed,
    $or: [{ 'access.score': { $gt: score } }, { 'access.score': score, 'access.since': { $lt: since } }],
  });
  const total = await ParticipantModel.countDocuments({ country, 'access.status': 'waiting', ...notClosed });
  return { status: 'waiting' as const, country, position: ahead + 1, total, score, since };
}

/**
 * Lets people in while there's room, best score first. Runs every hour and whenever a study goes live.
 * Emails each person let in.
 */
export async function admitWaiting(now = new Date()) {
  if (!config.waitlist.on) return { admitted: 0 };
  const places = await openPlaces(now);
  let admitted = 0;
  const countries: string[] = await ParticipantModel.distinct('country', { 'access.status': 'waiting' });
  for (const country of countries) {
    const room = config.waitlist.minSeats + config.waitlist.factor * (places.get(country) || 0);
    const free = room - (await activeIn(country));
    if (free <= 0) continue;
    const next: any[] = await ParticipantModel.find({ country, 'access.status': 'waiting', ...notClosed })
      .sort({ 'access.score': -1, 'access.since': 1, createdAt: 1 })
      .limit(free)
      .select('email firstName receivesUpdates');
    for (const p of next) {
      const r = await ParticipantModel.updateOne({ _id: p._id, 'access.status': 'waiting' }, { $set: { 'access.status': 'active', 'access.admittedAt': now } });
      if (!r.modifiedCount) continue;
      admitted += 1;
      try {
        await sendMail({
          to: p.email,
          subject: "You're in: you can take studies on joinStudy now",
          text: `Hi ${p.firstName || ''}, there's room for you now. Open joinStudy to see the studies that fit you and start earning.\n\n${env.FRONTEND_URL}/dashboard/participant`,
        });
      } catch (error) {
        logger.error({ error }, 'Waitlist email failed');
      }
    }
  }
  return { admitted };
}
