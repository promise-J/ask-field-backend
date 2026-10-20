import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../app';
import { connectDB } from '../../config/database';
import { outbox } from '../../utils/mailer';
import { signAccessToken } from '../../utils/jwt';
import { ParticipantModel } from '../../modules/user/models/participant.model';
import { SurveyActionModel, SurveyModel } from '../../modules/survey/survey.model';
import { TransactionModel } from '../../modules/wallet/transaction.model';
import { FundingModel } from '../../modules/billing/funding.model';
import { approve } from '../../modules/billing/launch.service';
import { closeAndSettleDue } from '../../modules/finish/finish.service';

/** Stage 8: finish. Close (early, full, date), settle unused money (credit or card), results CSV, statement, run again. */
const api = request(app);
const PASS = 'research-pass-1';
const lastMail = (to: string, re: RegExp) => [...outbox].reverse().find((m) => m.to.includes(to) && re.test(m.subject));
type Auth = { Authorization: string };
type P = Auth & { id: string; email: string };
let n = 0;

async function researcher(email: string): Promise<Auth> {
  await api.post('/api/researchers/auth/register').send({ fullName: 'Ada Obi', email, password: PASS }).expect(201);
  const url = new URL(lastMail(email, /verify/i)!.text.match(/https?:\/\/\S+/)![0]);
  const res = await api.get('/api/researchers/auth/verify-email').query({ email, token: url.searchParams.get('token') }).expect(200);
  const auth = { Authorization: `Bearer ${res.body.data.accessToken}` };
  await api.put('/api/researchers/me/profile').set(auth).send({ organizationType: 'company', organizationName: 'Lagos Labs', country: 'Nigeria' }).expect(200);
  return auth;
}
async function participant(): Promise<P> {
  const email = `p8-${++n}@example.com`;
  const p = await ParticipantModel.create({ email, firstName: 'P', lastName: String(n), password: 'x-not-used-1', isVerified: true, isCompleteProfile: true, profile: { countryOfResidence: 'Nigeria', dateOfBirth: new Date(1990, 0, 1) } });
  return { Authorization: `Bearer ${signAccessToken({ id: String(p._id), userType: 'participant' } as any)}`, id: String(p._id), email };
}
const PLAN = (places: number, extra: Record<string, unknown> = {}) => ({
  basics: { title: 'How Lagos commuters get to work', description: 'A short study about getting to work in Lagos.', consent: { mode: 'own', text: '' } },
  audience: { countries: ['Nigeria'], minAge: 18, maxAge: 100, questions: [{ text: 'How do you get to work?', answers: [{ text: 'Bus', qualifies: true }, { text: 'Car', qualifies: true }, { text: 'I work from home', qualifies: false }] }] },
  setup: { url: 'https://forms.example/lagos', minutes: 15, devices: ['phone'] },
  pay: { perPerson: 1000, places, ...extra },
});
async function liveStudy(auth: Auth, places: number, email: string, payExtra = {}, useCredit = false) {
  const s = await api.post('/api/surveys/start').set(auth).send({ method: 'survey' }).expect(201);
  const id = s.body.data.surveyId as string;
  const plan: any = PLAN(places, payExtra);
  for (const step of ['basics', 'audience', 'setup', 'pay']) {
    const r = await api.put(`/api/surveys/${id}/plan/${step}`).set(auth).send({ data: plan[step], final: true });
    if (r.status !== 200) throw new Error(`${step}: ${JSON.stringify(r.body)}`);
  }
  const r = await api.post(`/api/surveys/${id}/launch/pay`).set(auth).send({ method: 'card', useCredit, agree: true, receipt: { name: 'Ada Obi', email, country: 'Nigeria', reference: 'NSF-2231457' } }).expect(201);
  if (r.body.data.status === 'pending') await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(auth).expect(200);
  await approve(id);
  return id;
}
/** Screens in (answer "Car"), starts and finishes through the finish link. */
async function take(p: P, id: string) {
  await api.post(`/api/surveys/${id}/screen`).set(p).send({ answers: [1] }).expect(200);
  await SurveyActionModel.updateOne({ surveyId: id, participantId: p.id }, { $set: { startedAt: new Date(Date.now() - 12 * 60000) } });
  await api.post(`/api/surveys/done/${(await SurveyModel.findById(id))!.get('returnCode')}`).set(p).expect(200);
  return String((await SurveyActionModel.findOne({ surveyId: id, participantId: p.id }))!._id);
}
const decide = (auth: Auth, id: string, ids: string[], decision = 'approve', extra = {}) => api.post(`/api/surveys/${id}/review`).set(auth).send({ ids, decision, ...extra }).expect(200);

beforeAll(async () => {
  await connectDB(process.env.MONGO_URI!.replace(/\/[^/]*$/, '/joinstudy_stage8_test'));
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('closing early, then settling back to the card', () => {
  let auth: Auth;
  let id: string;
  const a: Record<string, string> = {};
  const people: P[] = [];

  beforeAll(async () => {
    auth = await researcher('ada8@lagoslabs.ng');
    id = await liveStudy(auth, 10, 'ada8@lagoslabs.ng'); // 10 × 1,000 + 20% = 12,000
    for (let i = 0; i < 4; i++) people.push(await participant());
    a.one = await take(people[0], id);
    a.two = await take(people[1], id);
    a.rej = await take(people[2], id);
    await api.post(`/api/surveys/${id}/screen`).set(people[3]).send({ answers: [0] }).expect(200); // still taking it
    await decide(auth, id, [a.one]);
    await decide(auth, id, [a.rej], 'reject', { reason: 'low-effort', note: '=HYPERLINK("x")' });
  });

  it('a live study has nothing to settle yet', async () => {
    const v = (await api.get(`/api/surveys/${id}/finish`).set(auth).expect(200)).body.data;
    expect(v).toMatchObject({ status: 'live', settlement: null, returnTo: 'credit', card: { last4: '4242' }, money: { paidIn: 12000, participants: 1000, fees: 200 } });
  });

  it('after closing: what still has to happen, and what will come back', async () => {
    await api.post(`/api/surveys/${id}/live/close`).set(auth).expect(200);
    const v = (await api.get(`/api/surveys/${id}/finish`).set(auth).expect(200)).body.data;
    expect(v).toMatchObject({ status: 'closed', closedReason: 'early', toReview: 1, stillFinishing: 1, unmarked: 0, settlement: null });
    expect(v.counts).toMatchObject({ approved: 1, rejected: 1, didntFinish: 0, places: 10, unusedPlaces: 8 });
    // 12,000 in − 1,200 spent − 1,200 if the one waiting is approved
    expect(v.money).toMatchObject({ waitingIfApproved: 1200, unused: 9600 });
    expect(new Date(v.settlesBy).getTime()).toBeGreaterThan(Date.now() + 6 * 864e5);
  });

  it('the researcher chooses the card; it can’t settle while work is waiting', async () => {
    const v = (await api.post(`/api/surveys/${id}/finish/return-to`).set(auth).send({ to: 'card' }).expect(200)).body.data;
    expect(v.returnTo).toBe('card');
    await api.post(`/api/surveys/${id}/finish/return-to`).set(auth).send({ to: 'bank' }).expect(400);
    expect((await closeAndSettleDue()).settled).toBe(0);
  });

  it('once the last work is decided and people mid-way have had their 2 hours, it settles: refunded to the card', async () => {
    await decide(auth, id, [a.two]);
    expect((await api.get(`/api/surveys/${id}/finish`).set(auth).expect(200)).body.data.settlement).toBeNull(); // grace still running
    await SurveyModel.updateOne({ _id: id }, { $set: { closedAt: new Date(Date.now() - 3 * 3600e3) } });
    const v = (await api.get(`/api/surveys/${id}/finish`).set(auth).expect(200)).body.data;
    expect(v.settlement).toMatchObject({ paidIn: 12000, participants: 2000, fees: 400, approved: 2, unused: 9600, refunded: 9600, credit: 0, refunds: [{ last4: '4242', amount: 9600 }] });
    expect(v.counts.didntFinish).toBe(1);
    const f: any = await FundingModel.findOne({ surveyId: id });
    expect(f.refunded).toBe(9600);
    expect(await TransactionModel.countDocuments({ surveyId: id, kind: 'refund', amount: 9600 })).toBe(1);
    expect(lastMail('ada8@lagoslabs.ng', /^Finished: How Lagos commuters/)!.text).toMatch(/NGN 9,600\.00 refunded to your card/);
    // Settling twice never pays twice.
    expect((await closeAndSettleDue()).settled).toBe(0);
    expect(await TransactionModel.countDocuments({ surveyId: id, kind: 'refund' })).toBe(1);
    expect((await api.post(`/api/surveys/${id}/finish/return-to`).set(auth).send({ to: 'credit' }).expect(409)).body.code).toBe('settled');
    const home = (await api.get('/api/researchers/me/home').set(auth).expect(200)).body.data;
    expect(home.money.held).toBe(0);
  });

  it('results CSV: one row per person, no contact details, safe in spreadsheets', async () => {
    const r = await api.get(`/api/surveys/${id}/results.csv`).set(auth).expect(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="how-lagos-commuters-get-to-work-results-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = r.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('code,joinstudy_id,status,started_at,finished_at,minutes,finished_by,checks,decided_by,reason,note_to_participant,quota_group,question_1');
    expect(lines).toHaveLength(5);
    expect(lines[1]).toMatch(new RegExp(`^P-01,${a.one},approved,.*,12,link,,researcher,,,,Car$`));
    expect(lines.find((l) => l.startsWith('P-03'))).toContain(`rejected`);
    expect(lines.find((l) => l.startsWith('P-03'))).toContain(`Answers show no real effort,"'=HYPERLINK(""x"")"`);
    expect(lines.find((l) => l.startsWith('P-04'))).toMatch(/didn’t finish/);
    expect(r.text).not.toMatch(/@example\.com/);
    const approvedOnly = await api.get(`/api/surveys/${id}/results.csv?show=approved`).set(auth).expect(200);
    expect(approvedOnly.text.trim().split('\r\n')).toHaveLength(3);
    await api.get(`/api/surveys/${id}/results.csv`).set(await researcher('kemi8@lagoslabs.ng')).expect(404);
  });

  it('the final statement adds up to a zero balance', async () => {
    const r = await api.get(`/api/surveys/${id}/statement`).set(auth).expect(200);
    expect(r.text).toMatch(/Final statement/);
    expect(r.text).toMatch(/Paid by card ending 4242 · JS-\d{4}-\d{4}/);
    expect(r.text).toMatch(/Paid to 2 participants<\/td><td>−NGN 2,000\.00/);
    expect(r.text).toMatch(/Unused, refunded to card ending 4242<\/td><td>−NGN 9,600\.00/);
    expect(r.text).toMatch(/Balance<\/td><td>NGN 0\.00/);
    expect(r.text).toMatch(/Reference NSF-2231457/);
  });

  it('run it again: a new draft with the same plan', async () => {
    const r = await api.post(`/api/surveys/${id}/run-again`).set(auth).expect(201);
    const copy: any = await SurveyModel.findById(r.body.data.surveyId);
    expect(copy).toMatchObject({ status: 'draft', method: 'survey' });
    expect(copy.plan.basics.title).toBe('How Lagos commuters get to work');
    expect(copy.plan.pay.places).toBe(10);
    const plan = (await api.get(`/api/surveys/${copy.id}/plan`).set(auth).expect(200)).body.data;
    expect(plan.ready).toBe(true);
  });
});

describe('settling as credit, and closing on its own', () => {
  let auth: Auth;
  beforeAll(async () => { auth = await researcher('tunde8@lagoslabs.ng'); });

  it('closes when every place is done, then settles unused money as credit', async () => {
    const id = await liveStudy(auth, 2, 'tunde8@lagoslabs.ng'); // 2,400
    const [p1, p2] = [await participant(), await participant()];
    await decide(auth, id, [await take(p1, id)]);
    expect((await closeAndSettleDue()).closed).toBe(0);
    await decide(auth, id, [await take(p2, id)]); // nothing unused: 2 × 1,200
    const r = await closeAndSettleDue();
    expect(r).toMatchObject({ closed: 1, settled: 1 });
    const s: any = await SurveyModel.findById(id);
    expect(s).toMatchObject({ status: 'closed', closedReason: 'full' });
    expect(s.settlement).toMatchObject({ unused: 0, credit: 0, refunded: 0 });
    expect(lastMail('tunde8@lagoslabs.ng', /^Closed: How Lagos commuters/)!.text).toMatch(/Every place is done/);
  });

  it('closes after its close date; unused money becomes credit, which pays for the next study', async () => {
    const id = await liveStudy(auth, 5, 'tunde8@lagoslabs.ng'); // 6,000
    const p = await participant();
    await decide(auth, id, [await take(p, id)]);
    await SurveyModel.updateOne({ _id: id }, { $set: { 'plan.pay.closes': 'date', 'plan.pay.closesAt': new Date(Date.now() - 864e5).toISOString().slice(0, 10) } });
    const r = await closeAndSettleDue();
    expect(r.closed).toBe(1);
    // closed just now: people mid-way get 2 hours, but nobody is mid-way, so it settles at once
    const s: any = await SurveyModel.findById(id);
    expect(s.closedReason).toBe('date');
    expect(s.settlement).toMatchObject({ unused: 4800, credit: 4800, refunded: 0 });
    const wallet = (await api.get('/api/researchers/wallet').set(auth).expect(200)).body.data;
    expect(wallet.credit).toBe(4800);
    const closed = (await api.get('/api/researchers/me/closed-studies').set(auth).expect(200)).body.data;
    expect(closed.studies.map((x: any) => x.settlement?.credit)).toEqual(expect.arrayContaining([4800, 0]));
    expect(closed.refundsOnTheWay).toBe(0);
    const statement = (await api.get(`/api/surveys/${id}/statement`).set(auth).expect(200)).text;
    expect(statement).toMatch(/Unused, returned as credit<\/td><td>−NGN 4,800\.00/);

    // The next study is paid entirely with that credit, so there's no card to refund to.
    const next = await liveStudy(auth, 4, 'tunde8@lagoslabs.ng', {}, true); // 4,800
    expect((await api.post(`/api/surveys/${next}/finish/return-to`).set(auth).send({ to: 'card' }).expect(400)).body.code).toBe('no_card');
  });
});
