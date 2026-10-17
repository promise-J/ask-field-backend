import { z } from 'zod';
import { config } from '../../config/env';

/**
 * Stage 4: the study planner. A study's plan lives in `survey.plan`, saved one step at a time:
 * basics → audience ("Who you need") → setup (per method) → pay.
 * The older flat fields (surveyName, surveyURL, minimumAge…) are kept in sync so participant pages keep working.
 */

export const METHODS = ['survey', 'interview', 'focus-group', 'product-test', 'ai-evaluation'] as const;
export type Method = (typeof METHODS)[number];
export const STEPS = ['basics', 'audience', 'setup', 'pay'] as const;
export type Step = (typeof STEPS)[number];

/** Countries participants can be recruited from today. Ghana and Kenya are "opening next". */
export const OPEN_COUNTRIES = ['Nigeria'];
export const GENDERS = ['woman', 'man', 'non-binary', 'self-described'] as const;
export const LANGUAGES = ['English', 'Nigerian Pidgin', 'Yoruba', 'Igbo', 'Hausa', 'French', 'Twi', 'Swahili'] as const;
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const text = (max: number) => z.string().trim().max(max);
const url = (msg = 'Enter a full link, starting with https://') =>
  z.string().trim().max(2000).refine((v) => v === '' || /^https?:\/\/[^\s]+\.[^\s]+/i.test(v), msg);
const int = (min: number, max: number, msg?: string) => z.coerce.number().int(msg).min(min, msg).max(max, msg);

// ---------------------------------------------------------------- step schemas

export const basicsSchema = z.object({
  title: text(160).min(1, 'Give your study a title participants will see.'),
  internalName: text(160).default(''),
  description: text(4000).default(''),
  sensitive: z.boolean().default(false),
  warning: text(1000).default(''),
  consent: z.object({ mode: z.enum(['joinstudy', 'own']).default('joinstudy'), text: text(20000).default('') }).default({ mode: 'joinstudy', text: '' }),
  ethics: z.object({ body: text(200).default(''), reference: text(120).default('') }).default({ body: '', reference: '' }),
})
  .refine((b) => b.consent.mode !== 'joinstudy' || b.consent.text.length >= 20, { message: 'Paste your consent information, or choose “I collect it myself”.', path: ['consent', 'text'] })
  .refine((b) => !b.sensitive || b.warning.length > 0, { message: 'Say what participants should know first.', path: ['warning'] });

const question = z.object({
  text: text(300).min(1, 'Write the question.'),
  answers: z
    .array(z.object({ text: text(200).min(1, 'Answers can’t be empty.'), qualifies: z.boolean() }))
    .min(2, 'Give each question at least 2 answers.')
    .max(8, 'Up to 8 answers per question.')
    .refine((a) => a.some((x) => x.qualifies), 'Tick at least one answer that qualifies.')
    .refine((a) => a.some((x) => !x.qualifies), 'At least one answer should not qualify, or the question screens nobody out.'),
});

export const audienceSchema = z
  .object({
    countries: z.array(z.string()).min(1, 'Choose at least one country.').refine((c) => c.every((x) => OPEN_COUNTRIES.includes(x)), 'We can only recruit in Nigeria right now.'),
    includeDiaspora: z.boolean().default(false),
    minAge: int(18, 100, 'Ages are from 18 to 100.').default(18),
    maxAge: int(18, 100, 'Ages are from 18 to 100.').default(100),
    genders: z.array(z.enum(GENDERS)).default([]), // empty = anyone
    languages: z.array(z.enum(LANGUAGES)).default([]),
    education: z.enum(['any', 'secondary', 'degree', 'postgraduate']).default('any'),
    employment: z.enum(['any', 'employed', 'self-employed', 'not-working']).default('any'),
    students: z.enum(['include', 'only', 'exclude']).default('include'),
    questions: z.array(question).max(3, 'Up to 3 questions.').default([]),
    quota: z
      .object({ by: z.enum(['gender', 'language']), groups: z.array(z.object({ value: text(60).min(1), places: int(1, 100000) })).min(2, 'A quota needs at least 2 groups.') })
      .nullable()
      .default(null),
  })
  .refine((a) => a.minAge <= a.maxAge, { message: 'The youngest age must be lower than the oldest.', path: ['maxAge'] });

const surveySetup = z.object({
  url: url('Enter your survey link, starting with https://'),
  passParticipantId: z.boolean().default(true),
  minutes: int(1, 600, 'Minutes must be between 1 and 600.'),
  devices: z.array(z.enum(['phone', 'computer', 'tablet'])).min(1, 'Choose at least one device.').default(['phone', 'computer']),
});
const slot = z.string().regex(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([01]\d|2[0-3]):[0-5]\d$/, 'Times look like “Mon 09:00”.');
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates look like 2026-10-26.');
const interviewSetup = z
  .object({
    count: int(1, 500, 'Between 1 and 500 interviews.'),
    minutes: int(5, 480, 'Interviews are 5 minutes to 8 hours.'),
    gapMinutes: z.union([z.literal(0), z.literal(15), z.literal(30)]).default(15),
    videoMode: z.enum(['one', 'each']).default('one'),
    videoUrl: url('Enter your meeting link, starting with https://').default(''),
    timeZone: text(60).min(1),
    from: isoDay,
    to: isoDay,
    weekly: z.array(slot).min(1, 'Choose at least one time you’re free.').max(7 * 24),
    standbyBackup: z.boolean().default(false),
  })
  .refine((v) => v.videoMode === 'each' || v.videoUrl, { message: 'Add your meeting link, or choose a new link each time.', path: ['videoUrl'] })
  .refine((v) => v.from <= v.to, { message: 'The end date must be after the start date.', path: ['to'] });
const focusSetup = z.object({
  perGroup: int(2, 20, 'Groups are 2 to 20 people.'),
  extras: int(0, 2).default(1),
  minutes: int(15, 240, 'Sessions are 15 minutes to 4 hours.'),
  videoUrl: url('Enter your meeting link, starting with https://'),
  timeZone: text(60).min(1),
  sessions: z.array(z.string().datetime({ offset: true, message: 'Each session needs a date and time.' })).min(1, 'Add at least one session.').max(50),
});
const productSetup = z.object({
  kind: z.enum(['web', 'app']).default('web'),
  url: url('Enter the link people will test, starting with https://'),
  tasks: z.array(text(300).min(1)).min(1, 'Add at least one task.').max(20),
  feedback: z.enum(['survey', 'recording']).default('survey'),
  feedbackUrl: url().default(''),
  minutes: int(1, 600, 'Minutes must be between 1 and 600.'),
  devices: z.array(z.enum(['phone', 'computer', 'tablet'])).min(1, 'Choose at least one device.').default(['phone']),
});
const aiSetup = z.object({
  kind: z.enum(['rate', 'compare', 'correct', 'write']).default('rate'),
  where: z.literal('own').default('own'), // "upload items, we host it" comes later
  toolUrl: url('Enter your tool link, starting with https://'),
  guidelines: text(20000).default(''),
  minutes: int(1, 600, 'Minutes must be between 1 and 600.'),
});
export const SETUP_SCHEMAS: Record<Method, z.ZodTypeAny> = {
  survey: surveySetup,
  interview: interviewSetup,
  'focus-group': focusSetup,
  'product-test': productSetup,
  'ai-evaluation': aiSetup,
};

export const paySchema = z
  .object({
    perPerson: z.coerce.number().min(0.01, 'Set what each person earns.').max(10_000_000),
    places: int(1, 100000, 'Places must be between 1 and 100,000.').optional(), // surveys, product tests, AI; others come from setup
    opens: z.enum(['approved', 'date']).default('approved'),
    opensAt: isoDay.nullable().default(null),
    closes: z.enum(['full', 'date']).default('full'),
    closesAt: isoDay.nullable().default(null),
    review: z.enum(['manual', 'auto']).default('manual'),
  })
  .refine((p) => p.opens === 'approved' || p.opensAt, { message: 'Choose the date it opens.', path: ['opensAt'] })
  .refine((p) => p.closes === 'full' || p.closesAt, { message: 'Choose the date it closes.', path: ['closesAt'] })
  .refine((p) => !p.opensAt || !p.closesAt || p.opensAt < p.closesAt, { message: 'It must close after it opens.', path: ['closesAt'] });

/** Plain-words messages for a field that hasn't been filled in yet. */
const REQUIRED: Record<string, string> = {
  title: 'Give your study a title participants will see.',
  countries: 'Choose at least one country.',
  url: 'Add the link participants will open.',
  minutes: 'Say how many minutes it takes.',
  count: 'Say how many interviews you need.',
  timeZone: 'Choose your time zone.',
  from: 'Choose the first day you’re free.',
  to: 'Choose the last day you’re free.',
  weekly: 'Choose at least one time you’re free.',
  perGroup: 'Say how many people per group.',
  videoUrl: 'Add your meeting link.',
  sessions: 'Add at least one session.',
  toolUrl: 'Add the link to your tool.',
  tasks: 'Add at least one task.',
  perPerson: 'Set what each person earns.',
};
export function messageFor(issue: { code: string; path: PropertyKey[]; message: string; input?: unknown }) {
  const key = String(issue.path[issue.path.length - 1] ?? '');
  if (issue.code === 'invalid_type' && issue.input === undefined && REQUIRED[key]) return REQUIRED[key];
  return issue.message;
}

/** Partial saves (autosave) skip "required" checks; a step is only "done" when the full schema passes. */
export function stepSchema(step: Step, method: Method) {
  if (step === 'basics') return basicsSchema;
  if (step === 'audience') return audienceSchema;
  if (step === 'setup') return SETUP_SCHEMAS[method];
  return paySchema;
}

// ---------------------------------------------------------------- derived figures

/** How many people the study needs, and how long each spends, from the plan. */
export function placesAndMinutes(method: Method, plan: any): { places: number; minutes: number } {
  const s = plan?.setup || {};
  if (method === 'interview') return { places: Number(s.count) || 0, minutes: Number(s.minutes) || 0 };
  if (method === 'focus-group') return { places: (Number(s.perGroup) || 0) * ((s.sessions || []).length || 0), minutes: Number(s.minutes) || 0 };
  return { places: Number(plan?.pay?.places) || 0, minutes: Number(s.minutes) || 0 };
}

export function hourly(perPerson: number, minutes: number) {
  return minutes > 0 ? Math.round(((perPerson * 60) / minutes) * 100) / 100 : 0;
}

/** What's left, per step, in plain words. Empty arrays everywhere means it can launch. */
export function missingByStep(method: Method, plan: any): Record<Step, string[]> {
  const out = {} as Record<Step, string[]>;
  for (const step of STEPS) {
    const r = stepSchema(step, method).safeParse(plan?.[step] ?? {});
    out[step] = r.success ? [] : [...new Set(r.error.issues.map((i: any) => messageFor(i)))];
  }
  if (!out.pay.length && ['survey', 'product-test', 'ai-evaluation'].includes(method) && !plan?.pay?.places) out.pay.push('Set how many people you need.');
  const { minutes } = placesAndMinutes(method, plan);
  const rate = hourly(Number(plan?.pay?.perPerson) || 0, minutes);
  if (!out.pay.length && config.minHourlyPay != null && rate < config.minHourlyPay) {
    out.pay.push(`Pay is below the minimum of ${config.minHourlyPay} an hour.`);
  }
  return out;
}

/** Writes the plan into the older flat fields that participant pages and the review flow read. */
export function legacyFields(method: Method, plan: any) {
  const b = plan?.basics || {};
  const a = plan?.audience || {};
  const s = plan?.setup || {};
  const p = plan?.pay || {};
  const { places, minutes } = placesAndMinutes(method, plan);
  const link = method === 'survey' ? s.url : method === 'product-test' ? s.url : method === 'ai-evaluation' ? s.toolUrl : s.videoUrl;
  const devices: string[] = s.devices || (['interview', 'focus-group'].includes(method) ? ['phone', 'computer'] : ['computer']);
  const out: Record<string, unknown> = {};
  if (b.title) out.surveyName = b.title;
  if (b.internalName !== undefined) out.internalSurveyName = b.internalName;
  if (b.description !== undefined) out.surveyDescription = b.description;
  if (b.sensitive !== undefined) out.contentWarning = b.sensitive ? b.warning || '' : '';
  if (a.minAge) out.minimumAge = a.minAge;
  if (a.maxAge) out.maximumAge = a.maxAge;
  if (a.genders) out.gender = a.genders.length === 1 ? a.genders[0] : '';
  if (link !== undefined) out.surveyURL = link || '';
  if (minutes) out.surveyDuration = minutes;
  if (places) out.numberOfParticipants = places;
  if (p.perPerson) out.surveyAmount = Number(p.perPerson);
  out.usableDevices = devices;
  out.surveyType = method === 'ai-evaluation' ? 'aiTaskBuilder' : 'external';
  return out;
}

// ---------------------------------------------------------------- matching participants

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
const COUNTRY_ALIASES: Record<string, string> = { usa: 'united states', us: 'united states', 'united states of america': 'united states', uk: 'united kingdom' };
const country = (v: unknown) => COUNTRY_ALIASES[norm(v)] ?? norm(v);
const GENDER_OF: Record<string, string> = { male: 'man', man: 'man', female: 'woman', woman: 'woman', 'non-binary': 'non-binary', nonbinary: 'non-binary' };
const EDU_RANK: Record<string, number> = { ssce: 1, waec: 1, secondary: 1, ond: 2, nce: 2, hnd: 2, diploma: 2, bsc: 3, ba: 3, bachelor: 3, degree: 3, msc: 4, ma: 4, mba: 4, phd: 5, doctorate: 5 };
const EDU_MIN: Record<string, number> = { any: 0, secondary: 1, degree: 3, postgraduate: 4 };
const listOf = (v: unknown) => (Array.isArray(v) ? v : String(v ?? '').split(/[,;/]/)).map(norm).filter(Boolean);

/** Does this participant's profile fit the audience? A filter that's set needs the profile to answer it. */
export function profileMatches(audience: any, participant: any, now = new Date()): { ok: boolean; reason?: string } {
  const a = audience || {};
  const p = participant?.profile || {};
  if (a.countries?.length) {
    const wanted = a.countries.map(country);
    const lives = wanted.includes(country(p.countryOfResidence));
    const born = a.includeDiaspora && wanted.includes(country(p.countryOfBirth));
    if (!lives && !born) return { ok: false, reason: 'This study is looking for people in other countries.' };
  }
  if (a.minAge || a.maxAge) {
    const dob = p.dateOfBirth ? new Date(p.dateOfBirth) : null;
    if (!dob) return { ok: false, reason: 'Add your date of birth to your profile to take this study.' };
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
    if (age < (a.minAge ?? 18) || age > (a.maxAge ?? 120)) return { ok: false, reason: `This study is for people aged ${a.minAge ?? 18}–${a.maxAge ?? 100}.` };
  }
  if (a.genders?.length && !a.genders.includes(GENDER_OF[norm(p.gender)] ?? norm(p.gender))) {
    return { ok: false, reason: 'This study is looking for a different group of people. Keep an eye out for the next one.' };
  }
  if (a.languages?.length) {
    const speaks = new Set([...listOf(p.firstLanguage), ...listOf(p.fluentLanguage)]);
    if (!a.languages.some((l: string) => speaks.has(norm(l)))) return { ok: false, reason: 'This study needs people who speak a language you haven’t listed.' };
  }
  if (a.education && a.education !== 'any') {
    const rank = EDU_RANK[norm(p.educationLevel).replace(/[^a-z]/g, '')] ?? 0;
    if (rank < EDU_MIN[a.education]) return { ok: false, reason: 'This study is looking for a different education background.' };
  }
  if (a.employment && a.employment !== 'any') {
    const e = norm(p.employmentStatus);
    const is = e.startsWith('self') ? 'self-employed' : e.startsWith('unemployed') || e.startsWith('not') ? 'not-working' : e.startsWith('employed') ? 'employed' : '';
    if (is !== a.employment) return { ok: false, reason: 'This study is looking for people in a different work situation.' };
  }
  if (a.students && a.students !== 'include') {
    const student = norm(p.isStudent) === 'yes';
    if ((a.students === 'only') !== student) return { ok: false, reason: 'This study is looking for a different group of people.' };
  }
  return { ok: true };
}

/** Which quota group a participant falls in, if any. */
export function quotaGroupOf(audience: any, participant: any): string | null {
  const q = audience?.quota;
  if (!q) return null;
  const p = participant?.profile || {};
  if (q.by === 'gender') {
    const g = GENDER_OF[norm(p.gender)] ?? norm(p.gender);
    return q.groups.find((x: any) => norm(x.value) === g)?.value ?? null;
  }
  const speaks = new Set([...listOf(p.firstLanguage), ...listOf(p.fluentLanguage)]);
  return q.groups.find((x: any) => speaks.has(norm(x.value)))?.value ?? null;
}

/** True when the answers (one index per question) all land on qualifying answers. */
export function screenerPasses(questions: any[], answers: number[]) {
  return questions.every((q, i) => q.answers?.[answers[i]]?.qualifies === true);
}

/** A short code for the return link, e.g. 7KQ2-XM. No 0/O or 1/I. */
export function newReturnCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n: number) => Array.from({ length: n }, () => A[Math.floor(Math.random() * A.length)]).join('');
  return `${pick(4)}-${pick(2)}`;
}

/** Studies with an open or close date are only shown between them (dates are whole days, in UTC). */
export function isOpenNow(survey: any, now = new Date()) {
  const p = survey?.plan?.pay || {};
  const today = now.toISOString().slice(0, 10);
  if (p.opens === 'date' && p.opensAt && today < p.opensAt) return false;
  if (p.closes === 'date' && p.closesAt && today > p.closesAt) return false;
  return true;
}
