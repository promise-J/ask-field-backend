import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../app';
import { connectDB } from '../../config/database';
import { env } from '../../config/env';
import { outbox } from '../../utils/mailer';
import { signAccessToken } from '../../utils/jwt';
import { ParticipantModel } from '../../modules/user/models/participant.model';
import { SurveyActionModel, SurveyModel } from '../../modules/survey/survey.model';
import { approve } from '../../modules/billing/launch.service';
import { sendStudyAlerts } from '../../modules/studies/studies.service';

/** Participant Stage 3: home, studies that fit, a page per study, "Not interested", and the new-study email. */
const api = request(app);
const lastMail = (to: string, re: RegExp) => [...outbox].reverse().find((m) => m.to.includes(to) && re.test(m.subject));
type Auth = { Authorization: string; id: string };
let n = 0;
const ME = '/api/participants/me';
const P = `${ME}/profile`;
const WORK = { education: 'bachelor', student: 'no', work: 'self-employed', devices: ['android', 'computer'] };

async function participant(region = 'Lagos', extra: Record<string, unknown> = {}, gender = 'female'): Promise<Auth> {
  const p = await ParticipantModel.create({ email: `p3-${++n}@example.com`, firstName: 'Amaka', lastName: 'Eze', password: 'x-not-used-1', isVerified: true, country: 'Nigeria', ...extra });
  const auth = { Authorization: `Bearer ${signAccessToken({ id: String(p._id), userType: 'participant' } as any)}`, id: String(p._id) };
  return auth;
}
async function finishProfile(p: Auth, region = 'Lagos', gender = 'female') {
  const h = { Authorization: p.Authorization };
  await api.put(`${P}/where`).set(h).send({ region, birthMonth: 5, birthYear: 1994, gender }).expect(200);
  await api.put(`${P}/languages`).set(h).send({ firstLanguage: 'Igbo', languages: ['English'] }).expect(200);
  await api.put(`${P}/work`).set(h).send(WORK).expect(200);
}
const H = (p: Auth) => ({ Authorization: p.Authorization });

let ada: { Authorization: string };
async function researcher(email: string) {
  await api.post('/api/researchers/auth/register').send({ fullName: 'Jane Okafor', email, password: 'research-pass-1' }).expect(201);
  const url = new URL(lastMail(email, /verify/i)!.text.match(/https?:\/\/\S+/)![0]);
  const res = await api.get('/api/researchers/auth/verify-email').query({ email, token: url.searchParams.get('token') }).expect(200);
  const auth = { Authorization: `Bearer ${res.body.data.accessToken}` };
  await api.put('/api/researchers/me/profile').set(auth).send({ organizationType: 'university', organizationName: 'University of Michigan', country: 'United States' }).expect(200);
  return auth;
}
let fundEmail = 0;
async function liveStudy(title: string, audience: Record<string, unknown>, pay = { perPerson: 2, places: 10 }, minutes = 15) {
  const s = await api.post('/api/surveys/start').set(ada).send({ method: 'survey' }).expect(201);
  const id = s.body.data.surveyId;
  const plan: Record<string, object> = {
    basics: { title, description: 'Questions about your trip to work.', consent: { mode: 'joinstudy', text: 'You can stop at any time.' }, ethics: { body: 'UM IRB', reference: 'HUM00241' } },
    audience: { countries: ['Nigeria'], minAge: 18, maxAge: 100, ...audience },
    setup: { url: 'https://forms.example/lagos', minutes, devices: ['phone'] },
    pay,
  };
  for (const step of ['basics', 'audience', 'setup', 'pay']) await api.put(`/api/surveys/${id}/plan/${step}`).set(ada).send({ data: plan[step], final: true }).expect(200);
  const r = await api.post(`/api/surveys/${id}/launch/pay`).set(ada).send({ method: 'card', agree: true, receipt: { name: 'Jane Okafor', email: `fund${++fundEmail}@umich.edu`, country: 'United States' } }).expect(201);
  await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(ada).expect(200);
  await approve(id);
  return id as string;
}

let lagos: string; // women in Lagos
let kano: string; // anyone in Kano
let everyone: string;

beforeAll(async () => {
  await connectDB(process.env.MONGO_URI!.replace(/\/[^/]*$/, '/joinstudy_p3_test'));
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  ada = await researcher('jane.p3@umich.edu');
  lagos = await liveStudy('How Lagos commuters get to work', { regions: ['Lagos'], genders: ['female'] });
  kano = await liveStudy('Market days in Kano', { regions: ['Kano'] }, { perPerson: 6, places: 5 }, 45);
  everyone = await liveStudy('Mobile money habits at home', {}, { perPerson: 1.5, places: 42 }, 10);
});
afterAll(async () => {
  env.REQUIRE_PARTICIPANT_VERIFICATION = false;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('3.1 one home for every situation', () => {
  it('a new account is asked to finish "About you", not sent away', async () => {
    const p = await participant();
    const h = await api.get(`${ME}/home`).set(H(p)).expect(200);
    expect(h.body.data).toMatchObject({ situation: 'profile', studies: [], profile: { complete: false, parts: { where: false, languages: false, work: false } } });
    expect(h.body.data.money).toMatchObject({ waiting: 0, ready: 0 });
  });

  it('lists only the studies that fit, in USD with the hourly rate', async () => {
    env.REQUIRE_PARTICIPANT_VERIFICATION = true;
    const p = await participant();
    await finishProfile(p);
    const h = await api.get(`${ME}/home`).set(H(p)).expect(200);
    expect(h.body.data.situation).toBe('verify');
    const titles = h.body.data.studies.map((s: any) => s.title);
    expect(titles).toEqual(expect.arrayContaining(['How Lagos commuters get to work', 'Mobile money habits at home']));
    expect(titles).not.toContain('Market days in Kano');
    const card = h.body.data.studies.find((s: any) => s.id === lagos);
    expect(card).toMatchObject({ pay: 2, hourly: 8, minutes: 15, currency: 'NGN', places: 10, placesLeft: 10, researcher: { name: 'Jane Okafor', organization: 'University of Michigan' } });
    expect(h.body.data.payRange).toEqual({ min: 1.5, max: 2 });
    // The verify page counts the same studies (it used to count every open study).
    expect((await api.get(`${ME}/verification`).set(H(p))).body.data.qualifying.count).toBe(2);
  });

  it('verified people are "ready"; men don\'t see a women-only study', async () => {
    const p = await participant('Lagos', { 'verification.status': 'verified' });
    await finishProfile(p, 'Lagos', 'male');
    const h = await api.get(`${ME}/home`).set(H(p)).expect(200);
    expect(h.body.data.situation).toBe('ready');
    expect(h.body.data.studies.map((s: any) => s.id)).toEqual([everyone]);
  });

  it('nothing fits: "waiting"; after a study, "all set"', async () => {
    const p = await participant('Lagos', { 'verification.status': 'verified' });
    await finishProfile(p, 'Abia', 'male');
    await api.put(`${ME}/studies/${everyone}/hide`).set(H(p)).expect(404); // wrong method
    await api.post(`${ME}/studies/${everyone}/hide`).set(H(p)).send({}).expect(200);
    expect((await api.get(`${ME}/home`).set(H(p))).body.data.situation).toBe('waiting');
    const s: any = await SurveyModel.findById(kano);
    await SurveyActionModel.create({ surveyId: kano, researcherId: s.userId, participantId: p.id, status: 'approved', amount: 6, currency: 'USD' });
    const h = await api.get(`${ME}/home`).set(H(p)).expect(200);
    expect(h.body.data).toMatchObject({ situation: 'all-set', doneCount: 1, hiddenCount: 1 });
  });

  it('shows a study they started, to continue', async () => {
    const p = await participant('Lagos', { 'verification.status': 'verified' });
    await finishProfile(p);
    await api.get(`/api/surveys/check-eligibility/${everyone}`).set(H(p)).expect(200);
    const h = await api.get(`${ME}/home`).set(H(p)).expect(200);
    expect(h.body.data.inProgress).toEqual([expect.objectContaining({ id: everyone, title: 'Mobile money habits at home', pay: 1.5 })]);
    expect(h.body.data.studies.map((s: any) => s.id)).not.toContain(everyone);
    expect((await api.get(`${ME}/studies/${everyone}`).set(H(p))).body.data.state).toBe('in-progress');
  });
});

describe('3.2 a page per study', () => {
  it('has everything they need to decide, and says what to do next', async () => {
    const p = await participant();
    await finishProfile(p);
    const r = await api.get(`${ME}/studies/${lagos}`).set(H(p)).expect(200);
    expect(r.body.data).toMatchObject({
      title: 'How Lagos commuters get to work',
      description: 'Questions about your trip to work.',
      ethics: 'UM IRB, HUM00241',
      consent: { required: true, text: 'You can stop at any time.' },
      devices: ['phone'],
      state: 'verify',
      fit: { ok: true, reason: null },
      paidWithin: 'within 7 days',
    });
    await ParticipantModel.updateOne({ _id: p.id }, { $set: { 'verification.status': 'verified' } });
    expect((await api.get(`${ME}/studies/${lagos}`).set(H(p))).body.data.state).toBe('start');
    await ParticipantModel.updateOne({ _id: p.id }, { $set: { 'verification.status': 'review' } });
    const review = await api.get(`${ME}/studies/${lagos}`).set(H(p)).expect(200);
    expect(review.body.data.state).toBe('blocked');
    expect(review.body.data.verification.message).toMatch(/checking your selfie/);
  });

  it('a study that doesn\'t fit says why, kindly; drafts and bad ids are not found', async () => {
    const p = await participant();
    await finishProfile(p);
    const r = await api.get(`${ME}/studies/${kano}`).set(H(p)).expect(200);
    expect(r.body.data.state).toBe('not-for-you');
    expect(r.body.data.fit.reason).toMatch(/other places/);
    await api.get(`${ME}/studies/nope`).set(H(p)).expect(404);
    const draft = await api.post('/api/surveys/start').set(ada).send({ method: 'survey' }).expect(201);
    await api.get(`${ME}/studies/${draft.body.data.surveyId}`).set(H(p)).expect(404);
  });
});

describe('3.3 Not interested', () => {
  it('hides it for them only, with an optional reason; they can bring it back', async () => {
    const p = await participant('Lagos', { 'verification.status': 'verified' });
    await finishProfile(p);
    const other = await participant('Lagos', { 'verification.status': 'verified' });
    await finishProfile(other);
    await api.post(`${ME}/studies/${lagos}/hide`).set(H(p)).send({ reason: 'nonsense' }).expect(400);
    await api.post(`${ME}/studies/${lagos}/hide`).set(H(p)).send({ reason: 'pay-low' }).expect(200);
    await api.post(`${ME}/studies/${lagos}/hide`).set(H(p)).send({ reason: 'pay-low' }).expect(200); // twice is fine

    const h = await api.get(`${ME}/home`).set(H(p)).expect(200);
    expect(h.body.data.studies.map((s: any) => s.id)).not.toContain(lagos);
    expect(h.body.data.hiddenCount).toBe(1);
    expect((await api.get(`${ME}/home`).set(H(other))).body.data.studies.map((s: any) => s.id)).toContain(lagos);

    const hidden = await api.get(`${ME}/studies/hidden`).set(H(p)).expect(200);
    expect(hidden.body.data).toEqual([expect.objectContaining({ id: lagos, reason: 'pay-low', reasonLabel: 'Pay is too low' })]);
    expect((await api.get(`${ME}/studies/${lagos}`).set(H(p))).body.data.hidden).toEqual({ reason: 'pay-low' });

    // The researcher sees totals, never who.
    const live = await api.get(`/api/surveys/${lagos}/live`).set(ada).expect(200);
    expect(live.body.data.declines).toMatchObject({ total: 1, reasons: { 'pay-low': 1, 'too-long': 0 } });
    expect(JSON.stringify(live.body.data.declines)).not.toContain(p.id);

    await api.delete(`${ME}/studies/${lagos}/hide`).set(H(p)).expect(200);
    expect((await api.get(`${ME}/home`).set(H(p))).body.data.studies.map((s: any) => s.id)).toContain(lagos);
  });
});

describe('3.4 the new-study email', () => {
  it('emails opted-in people once a day about new studies that fit, and stops in one click', async () => {
    const yes = await participant('Lagos', { receivesUpdates: true, createdAt: new Date(Date.now() - 30 * 864e5) });
    await finishProfile(yes);
    const no = await participant('Lagos', { receivesUpdates: false, createdAt: new Date(Date.now() - 30 * 864e5) });
    await finishProfile(no);
    const yesEmail = (await ParticipantModel.findById(yes.id))!.email;
    const noEmail = (await ParticipantModel.findById(no.id))!.email;

    const first = await sendStudyAlerts();
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const mail = lastMail(yesEmail, /new stud/)!;
    expect(mail.subject).toMatch(/^2 new studies fit you, up to /);
    expect(mail.text).toMatch(/How Lagos commuters get to work/);
    expect(mail.text).not.toMatch(/Market days in Kano/);
    expect(lastMail(noEmail, /new stud/)).toBeUndefined();

    // Not again the same day, even with a new study.
    await liveStudy('Saving with ajo', { regions: ['Lagos'] });
    const before = outbox.filter((m) => m.to === yesEmail).length;
    await sendStudyAlerts();
    expect(outbox.filter((m) => m.to === yesEmail).length).toBe(before);
    // A day later: only the new one.
    await sendStudyAlerts(new Date(Date.now() + 25 * 3600e3));
    const next = lastMail(yesEmail, /new stud/)!;
    expect(next.subject).toMatch(/^A new study fits you: .* for 15 minutes$/);
    expect(next.text).toMatch(/Saving with ajo/);

    const stop = new URL(next.text.match(/Stop these emails: (\S+)/)![1]);
    await api.post('/api/participants/alerts/stop').send({ u: stop.searchParams.get('u'), t: 'x'.repeat(32) }).expect(400);
    await api.post('/api/participants/alerts/stop').send({ u: stop.searchParams.get('u'), t: stop.searchParams.get('t') }).expect(200);
    expect((await ParticipantModel.findById(yes.id))!.receivesUpdates).toBe(false);

    await api.put(`${ME}/alerts`).set(H(yes)).send({ email: true }).expect(200);
    expect((await api.get(`${ME}/home`).set(H(yes))).body.data.alerts).toEqual({ email: true });
  });
});
