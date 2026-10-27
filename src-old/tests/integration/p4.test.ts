import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../app';
import { connectDB } from '../../config/database';
import { outbox } from '../../utils/mailer';
import { signAccessToken } from '../../utils/jwt';
import { ParticipantModel } from '../../modules/user/models/participant.model';
import { SurveyActionModel, SurveyModel } from '../../modules/survey/survey.model';
import { approve } from '../../modules/billing/launch.service';
import { expireHolds } from '../../modules/survey/holds';

/** Participant Stage 4: places are held, finishing needs the link or its code, leaving frees the place. */
const api = request(app);
const lastMail = (to: string, re: RegExp) => [...outbox].reverse().find((m) => m.to.includes(to) && re.test(m.subject));
type Auth = { Authorization: string; id: string };
let n = 0;
const ME = '/api/participants/me';
const H = (p: Auth) => ({ Authorization: p.Authorization });

async function participant(): Promise<Auth> {
  const p = await ParticipantModel.create({ email: `p4-${++n}@example.com`, firstName: 'Amaka', lastName: 'Eze', password: 'x-not-used-1', isVerified: true, country: 'Nigeria', 'verification.status': 'verified' });
  const auth = { Authorization: `Bearer ${signAccessToken({ id: String(p._id), userType: 'participant' } as any)}`, id: String(p._id) };
  const h = H(auth);
  await api.put(`${ME}/profile/where`).set(h).send({ region: 'Lagos', birthMonth: 5, birthYear: 1994, gender: 'female' }).expect(200);
  await api.put(`${ME}/profile/languages`).set(h).send({ firstLanguage: 'Igbo', languages: ['English'] }).expect(200);
  await api.put(`${ME}/profile/work`).set(h).send({ education: 'bachelor', student: 'no', work: 'self-employed', devices: ['android'] }).expect(200);
  return auth;
}

let ada: { Authorization: string };
const RESEARCHER = 'jane.p4@umich.edu';
async function researcher() {
  await api.post('/api/researchers/auth/register').send({ fullName: 'Jane Okafor', email: RESEARCHER, password: 'research-pass-1' }).expect(201);
  const url = new URL(lastMail(RESEARCHER, /verify/i)!.text.match(/https?:\/\/\S+/)![0]);
  const res = await api.get('/api/researchers/auth/verify-email').query({ email: RESEARCHER, token: url.searchParams.get('token') }).expect(200);
  const auth = { Authorization: `Bearer ${res.body.data.accessToken}` };
  await api.put('/api/researchers/me/profile').set(auth).send({ organizationType: 'university', organizationName: 'University of Michigan', country: 'United States' }).expect(200);
  return auth;
}
let fund = 0;
async function liveStudy(title: string, pay: Record<string, unknown>, minutes = 15) {
  const s = await api.post('/api/surveys/start').set(ada).send({ method: 'survey' }).expect(201);
  const id = s.body.data.surveyId;
  const plan: Record<string, object> = {
    basics: { title, description: 'About your trip to work.', consent: { mode: 'own', text: '' } },
    audience: { countries: ['Nigeria'], minAge: 18, maxAge: 100 },
    setup: { url: 'https://forms.example/lagos', minutes, devices: ['phone'] },
    pay,
  };
  for (const step of ['basics', 'audience', 'setup', 'pay']) await api.put(`/api/surveys/${id}/plan/${step}`).set(ada).send({ data: plan[step], final: true }).expect(200);
  const r = await api.post(`/api/surveys/${id}/launch/pay`).set(ada).send({ method: 'card', agree: true, receipt: { name: 'Jane Okafor', email: `fund${++fund}@umich.edu`, country: 'United States' } }).expect(201);
  await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(ada).expect(200);
  await approve(id);
  return id as string;
}
const codeOf = async (id: string) => String((await SurveyModel.findById(id))!.get('returnCode'));
const start = (p: Auth, id: string) => api.get(`/api/surveys/check-eligibility/${id}`).set(H(p));
const ago = (p: Auth, id: string, minutes: number) => SurveyActionModel.updateOne({ surveyId: id, participantId: p.id }, { $set: { startedAt: new Date(Date.now() - minutes * 60000) } });

beforeAll(async () => {
  await connectDB(process.env.MONGO_URI!.replace(/\/[^/]*$/, '/joinstudy_p4_test'));
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  ada = await researcher();
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('4.1 starting holds a place, so studies can’t overfill', () => {
  it('holds for 3× the length (at least an hour); a full study refuses new starts', async () => {
    const id = await liveStudy('Two places only', { perPerson: 2, places: 2 }, 30);
    const [a, b, c] = [await participant(), await participant(), await participant()];
    const before = Date.now();
    await start(a, id).expect(200);
    const held = (await SurveyActionModel.findOne({ surveyId: id, participantId: a.id }))!.get('heldUntil') as Date;
    expect(held.getTime() - before).toBeGreaterThanOrEqual(89 * 60000);
    expect(held.getTime() - before).toBeLessThanOrEqual(91 * 60000);
    const page = await api.get(`${ME}/studies/${id}`).set(H(a)).expect(200);
    expect(page.body.data).toMatchObject({ state: 'in-progress', holds: true, hasCode: true, placesLeft: 1 });
    expect(page.body.data).not.toHaveProperty('returnCode');

    await start(b, id).expect(200);
    const full = await start(c, id).expect(403);
    expect(full.body.code ?? full.body.error).toBeDefined();
    expect(full.body.message).toMatch(/full right now/);
    expect((await api.get(`${ME}/studies/${id}`).set(H(c))).body.data.state).toBe('full');
    expect((await api.get(`${ME}/home`).set(H(c))).body.data.studies.map((s: any) => s.id)).not.toContain(id);
    expect((await SurveyActionModel.countDocuments({ surveyId: id }))).toBe(2);
  });

  it('a short survey still holds for an hour; time running out frees the place', async () => {
    const id = await liveStudy('One place', { perPerson: 1, places: 1 }, 5);
    const [a, b] = [await participant(), await participant()];
    const t0 = Date.now();
    await start(a, id).expect(200);
    const held = (await SurveyActionModel.findOne({ surveyId: id, participantId: a.id }))!.get('heldUntil') as Date;
    expect(Math.round((held.getTime() - t0) / 60000)).toBe(60);
    await start(b, id).expect(403);

    await SurveyActionModel.updateOne({ surveyId: id, participantId: a.id }, { $set: { heldUntil: new Date(Date.now() - 1000) } });
    // Even before the sweep runs, an expired hold doesn't count.
    expect((await api.get(`${ME}/studies/${id}`).set(H(a))).body.data.myStatus).toBe('timed-out');
    expect((await expireHolds()).expired).toBe(1);
    const home = await api.get(`${ME}/home`).set(H(a)).expect(200);
    expect(home.body.data.inProgress).toEqual([expect.objectContaining({ id, expired: true, heldUntil: null })]);
    await api.post(`/api/surveys/${id}/start-link`).set(H(a)).send({ consent: true }).expect(409);
    await start(b, id).expect(200);
  });
});

describe('4.2–4.3 finishing', () => {
  it('needs the link or its code; “I’ve finished” alone is refused', async () => {
    const id = await liveStudy('Finish rules', { perPerson: 2, places: 10 });
    const p = await participant();
    await api.post(`${ME}/studies/${id}/finish`).set(H(p)).send({ code: 'ABCD-EF' }).expect(409); // not started
    await start(p, id).expect(200);
    await ago(p, id, 12);
    const self = await api.get(`/api/surveys/verify-survey-action/${id}`).set(H(p)).expect(409);
    expect(self.body.message).toMatch(/finish code/);
    const code = await codeOf(id);
    const typed = await api.post(`${ME}/studies/${id}/finish`).set(H(p)).send({ code: ` ${code.toLowerCase().replace('-', ' ')} ` }).expect(200);
    expect(typed.body.data).toMatchObject({ outcome: 'review', amount: 2 });
    const a = await SurveyActionModel.findOne({ surveyId: id, participantId: p.id });
    expect(a).toMatchObject({ status: 'submitted', finishedBy: 'code' });
    expect(a!.get('heldUntil')).toBeUndefined();
    const page = await api.get(`${ME}/studies/${id}`).set(H(p)).expect(200);
    expect(page.body.data).toMatchObject({ state: 'done', outcome: 'review' });
  });

  it('five wrong codes lock it for an hour', async () => {
    const id = await liveStudy('Wrong codes', { perPerson: 2, places: 10 });
    const p = await participant();
    await start(p, id).expect(200);
    for (let i = 4; i >= 1; i--) {
      const r = await api.post(`${ME}/studies/${id}/finish`).set(H(p)).send({ code: 'ZZZZ-ZZ' }).expect(400);
      expect(r.body.message).toMatch(new RegExp(`${i} tr(y|ies) left`));
    }
    await api.post(`${ME}/studies/${id}/finish`).set(H(p)).send({ code: 'ZZZZ-ZZ' }).expect(429);
    const locked = await api.post(`${ME}/studies/${id}/finish`).set(H(p)).send({ code: await codeOf(id) }).expect(429);
    expect(locked.body.message).toMatch(/Try again in \d+ minutes/);
  });

  it('auto-approve pays straight away, but not a very fast finish', async () => {
    const id = await liveStudy('Pays now', { perPerson: 3, places: 10, review: 'auto' }, 15);
    const [ok, fast] = [await participant(), await participant()];
    await start(ok, id).expect(200);
    await ago(ok, id, 14);
    const r = await api.post(`/api/surveys/done/${await codeOf(id)}`).set(H(ok)).expect(200);
    expect(r.body.data.outcome).toBe('paid');
    expect((await SurveyActionModel.findOne({ surveyId: id, participantId: ok.id }))!.status).toBe('approved');

    await start(fast, id).expect(200);
    await ago(fast, id, 1);
    const f = await api.post(`/api/surveys/done/${await codeOf(id)}`).set(H(fast)).expect(200);
    expect(f.body.data.outcome).toBe('review');
    expect((await SurveyActionModel.findOne({ surveyId: id, participantId: fast.id }))!.status).toBe('submitted');
    const review = await api.get(`/api/surveys/${id}/review`).set(ada);
    expect(review.status).toBe(200);
    expect(JSON.stringify(review.body.data)).toMatch(/"fast"/);
  });

  it('late: counted if a place is free, otherwise “over” and flagged for the researcher', async () => {
    const id = await liveStudy('Late finishers', { perPerson: 2, places: 1 });
    const [a, b] = [await participant(), await participant()];
    await start(a, id).expect(200);
    await ago(a, id, 20);
    await SurveyActionModel.updateOne({ surveyId: id, participantId: a.id }, { $set: { heldUntil: new Date(Date.now() - 1000) } });
    await expireHolds();
    await start(b, id).expect(200); // the freed place goes to b
    const late = await api.post(`/api/surveys/done/${await codeOf(id)}`).set(H(a)).expect(200);
    expect(late.body.data.outcome).toBe('late-over');
    expect(late.body.message).toMatch(/can still choose to pay you/);
    expect((await SurveyActionModel.findOne({ surveyId: id, participantId: a.id }))!.get('late')).toBe('over');

    const id2 = await liveStudy('Late, but room', { perPerson: 2, places: 5 });
    const c = await participant();
    await start(c, id2).expect(200);
    await ago(c, id2, 20);
    await SurveyActionModel.updateOne({ surveyId: id2, participantId: c.id }, { $set: { heldUntil: new Date(Date.now() - 1000) } });
    expect((await api.post(`/api/surveys/done/${await codeOf(id2)}`).set(H(c)).expect(200)).body.data.outcome).toBe('late');
  });
});

describe('4.4 leaving a study', () => {
  it('frees the place, can start again, and the researcher sees totals', async () => {
    const id = await liveStudy('Leave me', { perPerson: 2, places: 1 });
    const [a, b] = [await participant(), await participant()];
    await api.post(`${ME}/studies/${id}/leave`).set(H(a)).send({}).expect(409); // not taking part
    await start(a, id).expect(200);
    await start(b, id).expect(403);
    await api.post(`${ME}/studies/${id}/leave`).set(H(a)).send({ reason: 'nonsense' }).expect(400);
    await api.post(`${ME}/studies/${id}/leave`).set(H(a)).send({ reason: 'came-up' }).expect(200);
    expect((await SurveyActionModel.findOne({ surveyId: id, participantId: a.id }))).toMatchObject({ status: 'left', leftReason: 'came-up' });
    expect((await api.get(`${ME}/studies/${id}`).set(H(a))).body.data).toMatchObject({ myStatus: 'left', state: 'start' });
    await start(b, id).expect(200);
    await start(a, id).expect(403); // b has the place now
    const live = await api.get(`/api/surveys/${id}/live`).set(ada).expect(200);
    expect(live.body.data.leaves).toMatchObject({ left: 1, timedOut: 0, reasons: { 'came-up': 1 } });
    expect(JSON.stringify(live.body.data.leaves)).not.toContain(a.id);

    // Leaving and starting again keeps the same attempt (same P-code), with a fresh hold.
    await api.post(`${ME}/studies/${id}/leave`).set(H(b)).send({}).expect(200);
    const before = (await SurveyActionModel.findOne({ surveyId: id, participantId: a.id }))!.get('code');
    await start(a, id).expect(200);
    const again = await SurveyActionModel.findOne({ surveyId: id, participantId: a.id });
    expect(again).toMatchObject({ status: 'in-progress', code: before });
    expect(again!.get('leftReason')).toBeUndefined();
  });

  it('“the link didn’t work” tells the researcher, once a day', async () => {
    const id = await liveStudy('Broken link', { perPerson: 2, places: 10 });
    const before = outbox.filter((m) => m.to === RESEARCHER && /couldn't open your study link/.test(m.subject)).length;
    for (const p of [await participant(), await participant()]) {
      await start(p, id).expect(200);
      await api.post(`${ME}/studies/${id}/leave`).set(H(p)).send({ reason: 'link-broken' }).expect(200);
    }
    const mails = outbox.filter((m) => m.to === RESEARCHER && /couldn't open your study link/.test(m.subject));
    expect(mails.length - before).toBe(1);
    expect(mails[mails.length - 1].text).toMatch(/forms\.example\/lagos/);
  });
});
