import crypto from 'crypto';
import AppError from '../../../error-helpers/appError';
import { env } from '../../../config/env';
import logger from '../../../config/logger';
import { ParticipantModel } from '../models/participant.model';
import { COUNTRY_LANGUAGES, EDUCATION, GENDERS, optionsFor, REGIONS, WORK, DEVICES } from '../profile.options';

/**
 * Participant Stage 2: the "About you" profile (canvas 2.1–2.5) and the optional LinkedIn link.
 *
 * Three parts, saved one at a time. The profile is complete when all three are saved.
 * Guardrail: once someone is verified, country, birth month/year and gender are locked, so nobody
 * rewrites their profile to fit each study. A change goes through us (Help).
 */

export type Part = 'where' | 'languages' | 'work';
export const PARTS: Part[] = ['where', 'languages', 'work'];

const isVerified = (p: any) => p?.verification?.status === 'verified';
const countryOf = (p: any) => p.country || p.profile?.countryOfResidence || '';
const sexOf = (g: unknown) => {
  const v = String(g ?? '').trim().toLowerCase();
  return v === 'female' || v === 'woman' ? 'female' : v === 'male' || v === 'man' ? 'male' : '';
};

/** Age in whole years from a birth year and month (1–12). */
export function ageFromMonth(year: number, month: number, now = new Date()) {
  let age = now.getUTCFullYear() - year;
  if (now.getUTCMonth() + 1 < month) age -= 1;
  return age;
}

function view(p: any) {
  const pr = p.profile || {};
  const country = countryOf(p);
  const parts = pr.parts || {};
  return {
    country,
    answers: {
      region: pr.region || '',
      birthMonth: pr.birthMonth ?? (pr.dateOfBirth ? new Date(pr.dateOfBirth).getUTCMonth() + 1 : null),
      birthYear: pr.birthYear ?? (pr.dateOfBirth ? new Date(pr.dateOfBirth).getUTCFullYear() : null),
      gender: sexOf(pr.gender) || '',
      firstLanguage: pr.firstLanguage || '',
      languages: Array.isArray(pr.fluentLanguage) ? pr.fluentLanguage : pr.fluentLanguage ? String(pr.fluentLanguage).split(/[,;/]/).map((x: string) => x.trim()).filter(Boolean) : [],
      education: (EDUCATION as readonly string[]).includes(pr.educationLevel) ? pr.educationLevel : '',
      student: pr.isStudent === 'yes' || pr.isStudent === 'no' ? pr.isStudent : '',
      work: (WORK as readonly string[]).includes(pr.employmentStatus) ? pr.employmentStatus : '',
      devices: Array.isArray(pr.devices) ? pr.devices : [],
    },
    parts: { where: Boolean(parts.where), languages: Boolean(parts.languages), work: Boolean(parts.work) },
    complete: Boolean(p.isCompleteProfile),
    locked: isVerified(p),
    verification: p.verification?.status || 'none',
    linkedin: { connected: Boolean(p.linkedin?.connectedAt), connectedAt: p.linkedin?.connectedAt || null, nameMatches: p.linkedin?.nameMatches ?? null, testMode: !env.LINKEDIN_CLIENT_ID },
    options: optionsFor(country),
  };
}

export async function getProfile(id: string) {
  const p: any = await ParticipantModel.findById(id);
  if (!p) throw new AppError('Account not found.', 404);
  return view(p);
}

/** Saves one part. Checks each answer against the lists for the person's country. */
export async function savePart(id: string, part: Part, body: Record<string, any>) {
  const p: any = await ParticipantModel.findById(id);
  if (!p) throw new AppError('Account not found.', 404);
  const country = countryOf(p);
  const pr: any = { ...((p.profile as any)?.toObject?.() ?? p.profile ?? {}) };
  const bad = (msg: string, field: string) => new AppError(msg, 400, 'invalid', { field });

  if (part === 'where') {
    const regions = REGIONS[country]?.list || [];
    if (!regions.includes(body.region)) throw bad(`Choose your ${(REGIONS[country]?.label || 'region').toLowerCase()}.`, 'region');
    const year = Number(body.birthYear);
    const month = Number(body.birthMonth);
    if (!Number.isInteger(month) || month < 1 || month > 12) throw bad('Choose the month you were born.', 'birthMonth');
    if (!Number.isInteger(year) || year < 1900 || year > new Date().getUTCFullYear()) throw bad('Choose the year you were born.', 'birthYear');
    const age = ageFromMonth(year, month);
    if (age < 18) throw bad('You need to be 18 or older to take part in studies.', 'birthYear');
    if (age > 110) throw bad('Check your year of birth.', 'birthYear');
    const gender = sexOf(body.gender);
    if (!(GENDERS as readonly string[]).includes(gender)) throw bad('Choose Female or Male.', 'gender');

    if (isVerified(p)) {
      const before = view(p).answers;
      const changed = (before.birthYear && before.birthYear !== year) || (before.birthMonth && before.birthMonth !== month) || (before.gender && before.gender !== gender);
      if (changed) throw new AppError('Your birth date and gender are locked now that you’re verified. Ask us if one is wrong.', 409, 'locked');
    }
    Object.assign(pr, { countryOfResidence: country, region: body.region, birthYear: year, birthMonth: month, dateOfBirth: new Date(Date.UTC(year, month - 1, 1)), gender });
  } else if (part === 'languages') {
    const list = COUNTRY_LANGUAGES[country] || [];
    const first = String(body.firstLanguage || '').trim();
    if (!first) throw bad('Choose your first language.', 'firstLanguage');
    if (first.length > 60) throw bad('That language name is too long.', 'firstLanguage');
    const others: string[] = Array.isArray(body.languages) ? body.languages.map((x: unknown) => String(x).trim()).filter(Boolean) : [];
    if (others.length > 12 || others.some((l) => l.length > 60)) throw bad('Choose up to 12 languages.', 'languages');
    // Languages outside the country list are allowed ("Other"), but kept short and unique.
    Object.assign(pr, { firstLanguage: first, fluentLanguage: [...new Set(others.filter((l) => l !== first))] });
    void list;
  } else {
    if (!(EDUCATION as readonly string[]).includes(body.education)) throw bad('Choose your highest education.', 'education');
    if (!['yes', 'no'].includes(body.student)) throw bad('Say whether you’re a student right now.', 'student');
    if (!(WORK as readonly string[]).includes(body.work)) throw bad('Choose your work situation.', 'work');
    const devices: string[] = Array.isArray(body.devices) ? body.devices : [];
    if (!devices.length || devices.some((d) => !(DEVICES as readonly string[]).includes(d))) throw bad('Choose at least one device you can use.', 'devices');
    Object.assign(pr, { educationLevel: body.education, isStudent: body.student, employmentStatus: body.work, devices: [...new Set(devices)] });
  }

  pr.parts = { ...(pr.parts || {}), [part]: new Date() };
  p.set('profile', pr);
  p.isCompleteProfile = PARTS.every((k) => pr.parts?.[k]);
  await p.save();
  return view(p);
}

/** Older clients (the old popup) still post here. The same lock applies once verified. */
export function assertLegacyUnlocked(p: any, next: Record<string, any>) {
  if (!isVerified(p)) return;
  const pr = p.profile || {};
  const was = pr.dateOfBirth ? new Date(pr.dateOfBirth).toISOString().slice(0, 7) : '';
  const now = next.dateOfBirth ? new Date(next.dateOfBirth).toISOString().slice(0, 7) : was;
  const gender = next.gender !== undefined ? sexOf(next.gender) : sexOf(pr.gender);
  const country = next.countryOfResidence ?? pr.countryOfResidence;
  if ((was && now !== was) || (pr.gender && gender !== sexOf(pr.gender)) || (pr.countryOfResidence && country !== pr.countryOfResidence)) {
    throw new AppError('Your country, birth date and gender are locked now that you’re verified. Ask us if one is wrong.', 409, 'locked');
  }
}

/* ---------------- LinkedIn (optional) ---------------- */

const REDIRECT = () => `${env.FRONTEND_URL.replace(/\/$/, '')}/participate/linkedin`;

/** Step 1: where to send the person to connect LinkedIn. Test mode (no LinkedIn app set up) skips LinkedIn itself. */
export async function linkedinStart(id: string) {
  const state = crypto.randomBytes(16).toString('hex');
  await ParticipantModel.updateOne({ _id: id }, { $set: { linkedinState: state } });
  if (!env.LINKEDIN_CLIENT_ID) {
    if (env.NODE_ENV === 'production') throw new AppError('Connecting LinkedIn isn’t set up yet.', 503, 'linkedin_unavailable');
    return { url: `${REDIRECT()}?code=test-code&state=${state}`, testMode: true };
  }
  const q = new URLSearchParams({ response_type: 'code', client_id: env.LINKEDIN_CLIENT_ID, redirect_uri: REDIRECT(), state, scope: 'openid profile' });
  return { url: `https://www.linkedin.com/oauth/v2/authorization?${q}`, testMode: false };
}

const same = (a: string, b: string) => a.normalize('NFKD').replace(/[^a-z]/gi, '').toLowerCase() === b.normalize('NFKD').replace(/[^a-z]/gi, '').toLowerCase();

/** Step 2: LinkedIn sends them back with a code. We keep LinkedIn's account id and whether the name matches. Nothing else. */
export async function linkedinComplete(id: string, code: string, state: string) {
  const p: any = await ParticipantModel.findById(id).select('+linkedinState');
  if (!p) throw new AppError('Account not found.', 404);
  if (!p.linkedinState || p.linkedinState !== state) throw new AppError('That LinkedIn link has expired. Try connecting again.', 400, 'linkedin_state');

  let sub: string;
  let given = '';
  let family = '';
  if (!env.LINKEDIN_CLIENT_ID) {
    if (env.NODE_ENV === 'production') throw new AppError('Connecting LinkedIn isn’t set up yet.', 503, 'linkedin_unavailable');
    sub = `test-${p._id}`;
    given = p.firstName;
    family = p.lastName;
  } else {
    try {
      const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT(), client_id: env.LINKEDIN_CLIENT_ID, client_secret: env.LINKEDIN_CLIENT_SECRET || '' }),
      });
      const token: any = await tokenRes.json();
      if (!tokenRes.ok || !token.access_token) throw new Error(token.error_description || 'no token');
      const meRes = await fetch('https://api.linkedin.com/v2/userinfo', { headers: { authorization: `Bearer ${token.access_token}` } });
      const me: any = await meRes.json();
      if (!meRes.ok || !me.sub) throw new Error('no userinfo');
      sub = String(me.sub);
      given = String(me.given_name || '');
      family = String(me.family_name || '');
    } catch (err) {
      logger.warn({ err }, 'LinkedIn connect failed');
      throw new AppError('We couldn’t connect your LinkedIn. Try again.', 502, 'linkedin_failed');
    }
  }
  if (await ParticipantModel.exists({ _id: { $ne: p._id }, 'linkedin.sub': sub })) {
    throw new AppError('This LinkedIn is already connected to another joinStudy account.', 409, 'linkedin_taken');
  }
  p.linkedin = { sub, connectedAt: new Date(), nameMatches: same(given, p.firstName) && (!p.lastName || same(family, p.lastName)) };
  p.linkedinState = undefined;
  await p.save();
  return view(p);
}

export async function linkedinDisconnect(id: string) {
  const p: any = await ParticipantModel.findById(id);
  if (!p) throw new AppError('Account not found.', 404);
  p.linkedin = undefined;
  await p.save();
  return view(p);
}
