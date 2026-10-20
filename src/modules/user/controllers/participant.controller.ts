import { Request, Response } from 'express';
import { ParticipantModel } from '../models/participant.model';
import { AuthService } from '../services/auth.service';
import { makeAuthController } from './auth.controller';
import { asyncHandler } from '../../../utils/asyncHandler';
import { apiSuccessResponse } from '../../../utils/apiResponse';
import AppError from '../../../error-helpers/appError';
import { assertLegacyUnlocked } from '../services/profile.service';

export const participantAuth = new AuthService(ParticipantModel, 'participant');
export const participantController = makeAuthController(participantAuth);

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Turns dob_day / dob_month / dob_year (month as a number or a name) into a Date, or null if it isn't a real date. */
export function parseDob(day?: unknown, month?: unknown, year?: unknown): Date | null {
  const d = Number(day);
  const y = Number(year);
  const mRaw = String(month ?? '').trim().toLowerCase();
  let m = Number(mRaw);
  if (!Number.isInteger(m) || m < 1) {
    const idx = MONTHS.findIndex((name) => name.startsWith(mRaw.slice(0, 3)) && mRaw.length >= 3);
    m = idx + 1;
  }
  if (!Number.isInteger(d) || !Number.isInteger(y) || m < 1 || m > 12) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCDate() !== d || date.getUTCMonth() !== m - 1) return null;
  return date;
}

export function ageOn(dob: Date, now = new Date()) {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export const completeProfile = asyncHandler(async (req: Request, res: Response) => {
  const answers = req.body as Record<string, string | number | boolean>;
  const dob = parseDob(answers.dob_day, answers.dob_month, answers.dob_year);
  if (answers.dob_day !== undefined || answers.dob_year !== undefined) {
    if (!dob) throw new AppError('Enter a real date of birth.', 400);
    const age = ageOn(dob);
    if (age < 18) throw new AppError('You need to be 18 or older to take part in studies.', 400);
    if (age > 110) throw new AppError('Check your year of birth.', 400);
  }

  const user = await ParticipantModel.findById(req.user!.id);
  if (!user) throw new AppError('Account not found.', 404);

  assertLegacyUnlocked(user, { ...answers, ...(dob ? { dateOfBirth: dob } : {}) });
  const profile = { ...((user.profile as any)?.toObject?.() ?? user.profile ?? {}) };
  for (const [k, v] of Object.entries(answers)) profile[k] = typeof v === 'string' ? v.trim() : String(v);
  if (dob) profile.dateOfBirth = dob;

  user.set('profile', profile);
  user.isCompleteProfile = true;
  await user.save();
  apiSuccessResponse(res, 'Profile saved. You can now see studies that match you.', user.toJSON());
});
