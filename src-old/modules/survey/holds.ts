import { Types } from 'mongoose';
import { SurveyActionModel } from './survey.model';

/**
 * Participant Stage 4 (canvas 4.1): starting a link-based study holds a place for a set time,
 * so a study can't let more people start than it has places.
 */
const DONE = ['submitted', 'approved'];
export const LINK_METHODS = ['survey', 'product-test', 'ai-evaluation'];
export const methodOfSurvey = (s: any) => s?.method || (s?.surveyType === 'aiTaskBuilder' ? 'ai-evaluation' : 'survey');
/** Interviews and groups hold places through bookings instead (researcher Stage 6). */
export const holdsPlaces = (s: any) => LINK_METHODS.includes(methodOfSurvey(s));

/** Three times the study's length, and at least an hour. */
export function holdMinutes(minutes: number) {
  return Math.max(60, Math.round(3 * (Number(minutes) || 0)));
}

/** Finished, or started and still within their time. */
const takenMatch = (now: Date) => ({ $or: [{ status: { $in: DONE } }, { status: 'in-progress', heldUntil: { $gt: now } }] });

export function countTaken(surveyId: Types.ObjectId | string, now = new Date(), extra: Record<string, unknown> = {}) {
  return SurveyActionModel.countDocuments({ surveyId, ...extra, ...takenMatch(now) });
}

export async function takenCounts(ids: Types.ObjectId[], now = new Date()) {
  if (!ids.length) return new Map<string, number>();
  const rows = await SurveyActionModel.aggregate([
    { $match: { surveyId: { $in: ids }, ...takenMatch(now) } },
    { $group: { _id: '$surveyId', n: { $sum: 1 } } },
  ]);
  return new Map<string, number>(rows.map((r: any) => [String(r._id), r.n]));
}

/** Runs every few minutes: a hold that ran out frees the place. A late finish can still count (survey.service submit). */
export async function expireHolds(now = new Date()) {
  const r = await SurveyActionModel.updateMany(
    { status: 'in-progress', heldUntil: { $lte: now } },
    { $set: { status: 'timed-out', endedAt: now } }
  );
  return { expired: r.modifiedCount };
}
