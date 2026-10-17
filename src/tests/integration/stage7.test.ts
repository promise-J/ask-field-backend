import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../app';
import { connectDB } from '../../config/database';
import { outbox } from '../../utils/mailer';
import { signAccessToken } from '../../utils/jwt';
import { ParticipantModel } from '../../modules/user/models/participant.model';
import { SurveyActionModel, SurveyModel } from '../../modules/survey/survey.model';
import { TransactionModel } from '../../modules/wallet/transaction.model';
import { approve } from '../../modules/billing/launch.service';
import { BookingModel } from '../../modules/run/booking.model';
import { autoApproveDue, sendReviewReminders } from '../../modules/review/review.service';

/** Stage 7: review the work. Flags, approve/reject with reasons, bulk, attendance, 7-day auto-approve, reminders. */
const api = request(app);
const PASS = 'research-pass-1';
const lastMail = (to: string, re: RegExp) => [...outbox].reverse().find((m) => m.to.includes(to) && re.test(m.subject));
type Auth = { Authorization: string };
type P = Auth & { id: string; email: string };
let n = 0;
const DAY = 864e5;

async function researcher(email: string): Promise<Auth> {
  await api.post('/api/researchers/auth/register').send({ fullName: 'Ada Obi', email, password: PASS }).expect(201);
  const url = new URL(lastMail(email, /verify/i)!.text.match(/https?:\/\/\S+/)![0]);
  const res = await api.get('/api/researchers/auth/verify-email').query({ email, token: url.searchParams.get('token') }).expect(200);
  const auth = { Authorization: `Bearer ${res.body.data.accessToken}` };
  await api.put('/api/researchers/me/profile').set(auth).send({ organizationType: 'company', organizationName: 'Lagos Labs', country: 'Nigeria' }).expect(200);
  return auth;
}
async function participant(): Promise<P> {
  const email = `p7-${++n}@example.com`;
  const p = await ParticipantModel.create({ email, firstName: 'P', lastName: String(n), password: 'x-not-used-1', isVerified: true, isCompleteProfile: true, profile: { countryOfResidence: 'Nigeria', dateOfBirth: new Date(1990, 0, 1) } });
  return { Authorization: `Bearer ${signAccessToken({ id: String(p._id), userType: 'participant' } as any)}`, id: String(p._id), email };
}
const BASICS = { title: 'How Lagos commuters get to work', description: 'A short study about getting to work in Lagos.', consent: { mode: 'own', text: '' } };
const AUDIENCE = { countries: ['Nigeria'], minAge: 18, maxAge: 100 };
const RECEIPT = { name: 'Ada Obi', organization: 'Lagos Labs', email: 'ada7@lagoslabs.ng', cc: '', reference: '', country: 'Nigeria' };
async function liveStudy(auth: Auth, method: string, plan: Record<string, object>) {
  const s = await api.post('/api/surveys/start').set(auth).send({ method }).expect(201);
  const id = s.body.data.surveyId as string;
  const full = { basics: BASICS, audience: AUDIENCE, ...plan } as Record<string, object>;
  for (const step of ['basics', 'audience', 'setup', 'pay']) await api.put(`/api/surveys/${id}/plan/${step}`).set(auth).send({ data: full[step], final: true }).expect(200);
  const r = await api.post(`/api/surveys/${id}/launch/pay`).set(auth).send({ method: 'card', agree: true, receipt: RECEIPT }).expect(201);
  await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(auth).expect(200);
  await approve(id);
  return id;
}
const SURVEY = (review = 'manual') => ({ setup: { url: 'https://forms.example/lagos', minutes: 15, devices: ['phone'] }, pay: { perPerson: 1000, places: 10, review } });
/** Starts the study, as if `minutesAgo` ago, then finishes through the link (or says they finished, without it). */
async function take(p: P, id: string, minutesAgo: number, via: 'link' | 'self' = 'link') {
  await api.get(`/api/surveys/check-eligibility/${id}`).set(p).expect(200);
  await SurveyActionModel.updateOne({ surveyId: id, participantId: p.id }, { $set: { startedAt: new Date(Date.now() - minutesAgo * 60000) } });
  if (via === 'link') await api.post(`/api/surveys/done/${(await SurveyModel.findById(id))!.get('returnCode')}`).set(p).expect(200);
  else await api.get(`/api/surveys/verify-survey-action/${id}`).set(p).expect(200);
  return String((await SurveyActionModel.findOne({ surveyId: id, participantId: p.id }))!._id);
}

beforeAll(async () => {
  await connectDB(process.env.MONGO_URI!.replace(/\/[^/]*$/, '/joinstudy_stage7_test'));
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('reviewing a survey', () => {
  let auth: Auth;
  let id: string;
  const ids: Record<string, string> = {};
  const people: P[] = [];

  beforeAll(async () => {
    auth = await researcher('ada7@lagoslabs.ng');
    id = await liveStudy(auth, 'survey', SURVEY());
    for (let i = 0; i < 4; i++) people.push(await participant());
    // Someone rejected twice elsewhere recently.
    for (let i = 0; i < 2; i++) await SurveyActionModel.create({ surveyId: new mongoose.Types.ObjectId(), researcherId: new mongoose.Types.ObjectId(), participantId: people[3].id, status: 'rejected', reviewedAt: new Date() });
    ids.fast = await take(people[0], id, 2);
    ids.noLink = await take(people[1], id, 14, 'self');
    ids.good = await take(people[2], id, 12);
    ids.repeat = await take(people[3], id, 16);
  });

  it('lists work by code with quality checks, oldest first, with the auto-approve date', async () => {
    const v = (await api.get(`/api/surveys/${id}/review`).set(auth).expect(200)).body.data;
    expect(v).toMatchObject({ plannedMinutes: 15, perPerson: 1000, autoApproveDays: 7, reviewMode: 'manual', counts: { toReview: 4, flagged: 3, approved: 0, rejected: 0 } });
    const by = Object.fromEntries(v.items.map((i: any) => [i.surveyActionId, i]));
    expect(by[ids.fast]).toMatchObject({ code: 'P-01', minutes: 2, flags: ['fast'], finishedBy: 'link' });
    expect(by[ids.noLink]).toMatchObject({ code: 'P-02', flags: ['no-link'], finishedBy: 'self' });
    expect(by[ids.good].flags).toEqual([]);
    expect(by[ids.repeat].flags).toEqual(['rejected-before']);
    const due = new Date(by[ids.good].autoApproveAt).getTime() - new Date(by[ids.good].submittedAt).getTime();
    expect(Math.round(due / DAY)).toBe(7);
    expect(v.reasons.map((r: any) => r.key)).toEqual(['tasks', 'attention', 'low-effort', 'not-eligible', 'other']);
    expect(JSON.stringify(v)).not.toMatch(/@example\.com/);
  });

  it('only the owner can see or decide', async () => {
    const other = await researcher('kemi7@lagoslabs.ng');
    await api.get(`/api/surveys/${id}/review`).set(other).expect(404);
    await api.post(`/api/surveys/${id}/review`).set(other).send({ ids: [ids.good], decision: 'approve' }).expect(404);
    await api.get(`/api/surveys/${id}/review`).set(people[0]).expect(403);
  });

  it('rejecting needs a reason (and a note for “something else”); the participant is told why', async () => {
    expect((await api.post(`/api/surveys/${id}/review`).set(auth).send({ ids: [ids.fast], decision: 'reject' }).expect(400)).body.code).toBe('reason_required');
    expect((await api.post(`/api/surveys/${id}/review`).set(auth).send({ ids: [ids.fast], decision: 'reject', reason: 'other' }).expect(400)).body.code).toBe('note_required');
    const r = await api.post(`/api/surveys/${id}/review`).set(auth).send({ ids: [ids.fast], decision: 'reject', reason: 'low-effort', note: 'The open answers were one word each.' }).expect(200);
    expect(r.body.data).toMatchObject({ done: 1, skipped: 0, view: { counts: { toReview: 3, rejected: 1 } } });
    const mail = lastMail(people[0].email, /^Not approved: How Lagos commuters/)!;
    expect(mail.text).toMatch(/the answers didn’t show real effort/);
    expect(mail.text).toMatch(/The researcher's note: The open answers were one word each\./);
    expect(mail.text).not.toMatch(/ada7@lagoslabs/);
    const a: any = await SurveyActionModel.findById(ids.fast);
    expect(a.review).toMatchObject({ by: 'researcher', reason: 'low-effort', note: 'The open answers were one word each.' });
    const earning: any = await TransactionModel.findOne({ ledgerKey: `${ids.fast}:earning` });
    expect(earning).toMatchObject({ status: 'cancelled', description: 'Not approved: Answers show no real effort' });
  });

  it('approves several at once; anything already decided is skipped; each participant is paid and told', async () => {
    const r = await api.post(`/api/surveys/${id}/review`).set(auth).send({ ids: [ids.good, ids.repeat, ids.fast], decision: 'approve' }).expect(200);
    expect(r.body.data).toMatchObject({ done: 2, skipped: 1, view: { counts: { toReview: 1, approved: 2, rejected: 1, flagged: 1 } } });
    expect(await TransactionModel.countDocuments({ surveyId: id, kind: 'earning', status: 'available' })).toBe(2);
    expect(await TransactionModel.countDocuments({ surveyId: id, kind: 'charge', status: 'paid' })).toBe(2);
    expect(lastMail(people[2].email, /^Approved: How Lagos commuters/)!.text).toMatch(/NGN 1000\.00 is in your joinStudy balance/);
    expect((await SurveyActionModel.findById(ids.fast))!.status).toBe('rejected');
  });

  it('“To review” lists studies with work waiting', async () => {
    const rows = (await api.get('/api/researchers/me/to-review').set(auth).expect(200)).body.data;
    expect(rows).toEqual([expect.objectContaining({ surveyId: id, name: 'How Lagos commuters get to work', count: 1, flagged: 1, toMark: 0 })]);
  });

  it('reminds the researcher once, 2 days before work is approved automatically', async () => {
    await SurveyActionModel.updateOne({ _id: ids.noLink }, { $set: { submittedAt: new Date(Date.now() - 5.5 * DAY) } });
    expect(await sendReviewReminders()).toBe(1);
    expect(lastMail('ada7@lagoslabs.ng', /^Work waiting for your review/)!.text).toMatch(/How Lagos commuters get to work: 1 to review/);
    expect(await sendReviewReminders()).toBe(0);
  });

  it('after 7 days, undecided work is approved automatically and paid', async () => {
    expect(await autoApproveDue()).toBe(0);
    await SurveyActionModel.updateOne({ _id: ids.noLink }, { $set: { submittedAt: new Date(Date.now() - 7.1 * DAY) } });
    expect(await autoApproveDue()).toBe(1);
    const a: any = await SurveyActionModel.findById(ids.noLink);
    expect(a.status).toBe('approved');
    expect(a.review.by).toBe('auto');
    expect(await TransactionModel.countDocuments({ surveyActionId: ids.noLink, kind: 'charge' })).toBe(1);
    expect(lastMail(people[1].email, /^Approved/)).toBeTruthy();
    expect(await autoApproveDue()).toBe(0);
  });
});

describe('“approve automatically” in the plan', () => {
  it('pays as soon as they finish', async () => {
    const auth = await researcher('tunde7@lagoslabs.ng');
    const id = await liveStudy(auth, 'survey', SURVEY('auto'));
    const p = await participant();
    const actionId = await take(p, id, 10);
    const a: any = await SurveyActionModel.findById(actionId);
    expect(a.status).toBe('approved');
    expect(a.review.by).toBe('auto');
    expect(await TransactionModel.countDocuments({ surveyActionId: actionId, kind: 'earning', status: 'available' })).toBe(1);
    expect((await api.get(`/api/surveys/${id}/review`).set(auth).expect(200)).body.data.reviewMode).toBe('auto');
  });
});

describe('focus-group attendance', () => {
  let auth: Auth;
  let id: string;
  const at = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10) + 'T14:00:00.000Z';

  beforeAll(async () => {
    auth = await researcher('bisi7@lagoslabs.ng');
    id = await liveStudy(auth, 'focus-group', { setup: { perGroup: 3, extras: 0, minutes: 60, videoUrl: 'https://meet.example/abc', timeZone: 'UTC', sessions: [at(3)] }, pay: { perPerson: 4000 } });
    for (let i = 0; i < 3; i++) {
      const p = await participant();
      await api.get(`/api/surveys/check-eligibility/${id}`).set(p).expect(200);
      await api.post(`/api/surveys/${id}/start-link`).set(p).send({}).expect(200);
      await api.post(`/api/surveys/${id}/book`).set(p).send({ start: at(3) }).expect(201);
    }
  });

  it('can’t be saved before the session starts', async () => {
    const list = await BookingModel.find({ surveyId: id });
    expect((await api.post(`/api/surveys/${id}/attendance`).set(auth).send({ joined: [list[0].id] }).expect(409)).body.code).toBe('not_yet');
  });

  it('saves who joined in one go: they are paid; the others aren’t charged', async () => {
    await BookingModel.updateMany({ surveyId: id }, { $set: { start: new Date(Date.now() - 2 * 3600e3), end: new Date(Date.now() - 3600e3) } });
    const rows = (await api.get('/api/researchers/me/to-review').set(auth).expect(200)).body.data;
    expect(rows[0]).toMatchObject({ surveyId: id, count: 0, toMark: 1 });
    const [a, b, c] = await BookingModel.find({ surveyId: id }).sort({ _id: 1 });
    const r = await api.post(`/api/surveys/${id}/attendance`).set(auth).send({ joined: [a.id, b.id], missed: [c.id] }).expect(200);
    expect(r.body.data).toEqual({ joined: 2, missed: 1 });
    expect((await BookingModel.find({ surveyId: id }).sort({ _id: 1 })).map((x) => x.status)).toEqual(['happened', 'happened', 'noshow']);
    const actions: any[] = await SurveyActionModel.find({ surveyId: id }).sort({ _id: 1 });
    expect(actions.map((x) => x.status)).toEqual(['approved', 'approved', 'no-show']);
    expect(actions[0].review.by).toBe('attendance');
    expect(actions[0].finishedBy).toBe('booking');
    expect(await TransactionModel.countDocuments({ surveyId: id, kind: 'charge' })).toBe(2);
    const other = await researcher('femi7@lagoslabs.ng');
    await api.post(`/api/surveys/${id}/attendance`).set(other).send({ joined: [a.id] }).expect(404);
  });

  it('bookings nobody marked are reminded a day later, then count as attended after 7 days', async () => {
    const p = await participant();
    const s: any = await SurveyModel.findById(id);
    const action = await SurveyActionModel.create({ surveyId: id, researcherId: s.userId, participantId: p.id, code: 'P-09', amount: 4000, currency: 'NGN' });
    const b = await BookingModel.create({ surveyId: id, researcherId: s.userId, participantId: p.id, surveyActionId: action._id, start: new Date(Date.now() - 2 * DAY), end: new Date(Date.now() - 2 * DAY + 3600e3), participantTz: 'UTC' });
    expect(await sendReviewReminders()).toBe(1);
    expect(lastMail('bisi7@lagoslabs.ng', /^Work waiting/)!.text).toMatch(/mark who joined/);
    expect(await autoApproveDue()).toBe(0);
    await BookingModel.updateOne({ _id: b._id }, { $set: { start: new Date(Date.now() - 8 * DAY), end: new Date(Date.now() - 8 * DAY + 3600e3) } });
    expect(await autoApproveDue()).toBe(1);
    expect((await BookingModel.findById(b._id))!.status).toBe('happened');
    expect((await SurveyActionModel.findById(action._id))!.get('review.by')).toBe('auto');
  });
});
