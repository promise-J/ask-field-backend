import request from 'supertest';
import mongoose from 'mongoose';
import crypto from 'crypto';
import app from '../../app';
import { connectDB } from '../../config/database';
import { outbox } from '../../utils/mailer';
import { signAccessToken } from '../../utils/jwt';
import { ParticipantModel } from '../../modules/user/models/participant.model';
import { SurveyModel } from '../../modules/survey/survey.model';
import { TransactionModel } from '../../modules/wallet/transaction.model';
import { FundingModel } from '../../modules/billing/funding.model';
import { approve, markInvoicePaid, reject, requestChanges } from '../../modules/billing/launch.service';

/** Stage 5: fund and launch. Pay up front (card, invoice or credit), automatic checks, our review, live. */
const api = request(app);
const PASS = 'research-pass-1';
const lastMail = (to: string, re: RegExp) => [...outbox].reverse().find((m) => m.to.includes(to) && re.test(m.subject));
type Auth = { Authorization: string };

async function researcher(email: string): Promise<Auth> {
  await api.post('/api/researchers/auth/register').send({ fullName: 'Ada Obi', email, password: PASS }).expect(201);
  const url = new URL(lastMail(email, /verify/i)!.text.match(/https?:\/\/\S+/)![0]);
  const res = await api.get('/api/researchers/auth/verify-email').query({ email, token: url.searchParams.get('token') }).expect(200);
  const auth = { Authorization: `Bearer ${res.body.data.accessToken}` };
  await api.put('/api/researchers/me/profile').set(auth).send({ organizationType: 'university', organizationName: 'University of Florida', country: 'United States' }).expect(200);
  return auth;
}
const PLAN = (places = 10, extra: Record<string, unknown> = {}) => ({
  basics: { title: 'How Lagos commuters get to work', description: 'A 15-minute survey about how you get to work in Lagos.', consent: { mode: 'own', text: '' } },
  audience: { countries: ['Nigeria'], minAge: 18, maxAge: 100 },
  setup: { url: 'https://forms.example/lagos', minutes: 15, devices: ['phone'] },
  pay: { perPerson: 1000, places, ...extra },
});
async function readyStudy(auth: Auth, places = 10, payExtra = {}) {
  const s = await api.post('/api/surveys/start').set(auth).send({ method: 'survey' }).expect(201);
  const id = s.body.data.surveyId;
  const plan: any = PLAN(places, payExtra);
  for (const step of ['basics', 'audience', 'setup', 'pay']) await api.put(`/api/surveys/${id}/plan/${step}`).set(auth).send({ data: plan[step], final: true }).expect(200);
  return id as string;
}
const RECEIPT = { name: 'Ada Obi', organization: 'University of Florida', email: 'ada5@ufl.edu', cc: 'grants@ufl.edu', reference: 'NSF-2231457', country: 'United States' };
const pay = (auth: Auth, id: string, body: object) => api.post(`/api/surveys/${id}/launch/pay`).set(auth).send({ method: 'card', agree: true, receipt: RECEIPT, ...body });

beforeAll(async () => {
  await connectDB(process.env.MONGO_URI!.replace(/\/[^/]*$/, '/joinstudy_stage5_test'));
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('paying by card, our check, live', () => {
  let auth: Auth;
  let id: string;

  it('shows the full cost due, and test card payments when Stripe isn’t set up', async () => {
    auth = await researcher('ada5@ufl.edu');
    id = await readyStudy(auth);
    const v = (await api.get(`/api/surveys/${id}/launch`).set(auth).expect(200)).body.data;
    // 10 × 1,000 + 18% academic fee
    expect(v).toMatchObject({ ready: true, launchStage: 'none', paidIn: 0, due: 11800, credit: 0, payments: { cards: 'test' }, figures: { total: 11800 } });
  });

  it('won’t launch without paying, without the confirmation, or with an unfinished plan', async () => {
    expect((await api.post(`/api/surveys/publish-draft-survey/${id}`).set(auth).expect(402)).body.code).toBe('payment_required');
    expect((await pay(auth, id, { agree: false }).expect(400)).body.code).toBe('agree_required');
    expect((await pay(auth, id, { receipt: { ...RECEIPT, email: 'nope' } }).expect(400)).body.message).toMatch(/valid email/);
    const draft = await api.post('/api/surveys/start').set(auth).send({ method: 'survey' }).expect(201);
    expect((await pay(auth, draft.body.data.surveyId, {}).expect(400)).body.code).toBe('plan_incomplete');
    const interview = await api.post('/api/surveys/start').set(auth).send({ method: 'interview' }).expect(201);
    for (const [step, data] of [['basics', PLAN().basics], ['setup', { count: 5, minutes: 30, videoMode: 'each', timeZone: 'UTC', from: '2026-11-01', to: '2026-11-10', weekly: ['Mon 09:00'] }], ['pay', { perPerson: 5000 }]] as const) {
      await api.put(`/api/surveys/${interview.body.data.surveyId}/plan/${step}`).set(auth).send({ data, final: true }).expect(200);
    }
    // Stage 6: booking is built, so interviews launch like any other study.
    expect((await pay(auth, interview.body.data.surveyId, {}).expect(201)).body.data.status).toBe('pending');
  });

  it('a card payment, once confirmed, starts our check and sends a receipt', async () => {
    const r = await pay(auth, id, {}).expect(201);
    expect(r.body.data).toMatchObject({ status: 'pending', method: 'card', provider: 'test', amount: 11800 });
    expect(r.body.data.clientSecret).toMatch(/^test_secret_/);
    await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(auth).expect(200);
    const v = (await api.get(`/api/surveys/${id}/launch`).set(auth).expect(200)).body.data;
    expect(v).toMatchObject({ launchStage: 'checking', paidIn: 11800, due: 0 });
    expect(v.review.checks.map((c: any) => c.key)).toEqual(['consent', 'pay', 'description', 'link']);
    expect(v.fundings[0]).toMatchObject({ status: 'paid', cardLast4: '4242', number: expect.stringMatching(/^JS-\d{4}-0001$/) });
    expect(lastMail('ada5@ufl.edu', /^Receipt JS-/)!.to).toBe('ada5@ufl.edu, grants@ufl.edu');
    expect(lastMail('hello@joinstudy.io', /Study to review/)).toBeTruthy();
    expect(await TransactionModel.countDocuments({ kind: 'funding', surveyId: id })).toBe(1);
    const doc = await api.get(`/api/billing/fundings/${r.body.data.fundingId}/document`).set(auth).expect(200);
    expect(doc.text).toMatch(/Receipt JS-\d{4}-0001/);
    expect(doc.text).toMatch(/NSF-2231457/);
  });

  it('the plan is locked while we check it', async () => {
    expect((await api.put(`/api/surveys/${id}/plan/pay`).set(auth).send({ data: { places: 20 } }).expect(409)).body.code).toBe('in_review');
    expect((await pay(auth, id, {}).expect(409)).body.code).toBe('in_review');
  });

  it('“changes needed”: fix it; if the cost goes up, pay the difference to send it back', async () => {
    await requestChanges(id, 'Remove the question asking for phone numbers.');
    const home = (await api.get('/api/researchers/me/home').set(auth).expect(200)).body.data;
    expect(home.needsYou[0]).toMatchObject({ kind: 'changes', surveyId: id, note: 'Remove the question asking for phone numbers.' });
    await api.put(`/api/surveys/${id}/plan/pay`).set(auth).send({ data: { places: 12 }, final: true }).expect(200);
    const up = await api.post(`/api/surveys/${id}/launch/resubmit`).set(auth).expect(402);
    expect(up.body).toMatchObject({ code: 'top_up_needed', data: { due: 2360 } });
    const r = await pay(auth, id, {}).expect(201);
    expect(r.body.data.amount).toBe(2360);
    await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(auth).expect(200);
    expect((await api.get(`/api/surveys/${id}/launch`).set(auth).expect(200)).body.data).toMatchObject({ launchStage: 'checking', paidIn: 14160, due: 0 });
  });

  it('approved: live, and the money shows as held', async () => {
    await approve(id);
    const s: any = await SurveyModel.findById(id);
    expect(s).toMatchObject({ status: 'published', launchStage: 'none' });
    const home = (await api.get('/api/researchers/me/home').set(auth).expect(200)).body.data;
    expect(home.money).toMatchObject({ held: 14160, paid: 0 });
    const p = await ParticipantModel.create({ email: 'p5@example.com', firstName: 'P', password: 'x-not-used-1', isVerified: true, isCompleteProfile: true, profile: { countryOfResidence: 'Nigeria', dateOfBirth: new Date(1990, 0, 1) } });
    const list = await api.get('/api/surveys/get-all-surveys').set({ Authorization: `Bearer ${signAccessToken({ id: String(p._id), userType: 'participant' } as any)}` }).expect(200);
    expect(list.body.data.map((x: any) => x.surveyId)).toContain(id);
  });
});

describe('invoices, credit, refunds', () => {
  let auth: Auth;
  beforeAll(async () => { auth = await researcher('kemi5@ufl.edu'); });

  it('an invoice waits for the money; the plan stays locked until it’s cancelled or paid', async () => {
    const id = await readyStudy(auth);
    const r = await pay(auth, id, { method: 'invoice', receipt: { ...RECEIPT, email: 'kemi5@ufl.edu' } }).expect(201);
    expect(r.body.data).toMatchObject({ method: 'invoice', number: expect.stringMatching(/^JS-\d{4}-\d{4}$/), reference: expect.stringMatching(/^JS-[0-9A-F]{6}$/) });
    expect(lastMail('kemi5@ufl.edu', /^Invoice JS-/)!.text).toMatch(/Reference to quote: JS-/);
    expect((await api.get(`/api/surveys/${id}/launch`).set(auth).expect(200)).body.data.launchStage).toBe('awaiting-payment');
    expect((await api.put(`/api/surveys/${id}/plan/pay`).set(auth).send({ data: { places: 5 } }).expect(409)).body.code).toBe('awaiting_payment');
    const doc = await api.get(`/api/billing/fundings/${r.body.data.fundingId}/document`).set(auth).expect(200);
    expect(doc.text).toMatch(/Invoice JS-/);
    await markInvoicePaid(r.body.data.number);
    expect((await api.get(`/api/surveys/${id}/launch`).set(auth).expect(200)).body.data).toMatchObject({ launchStage: 'checking', paidIn: 11800 });
  });

  it('cancelling an invoice unlocks the plan', async () => {
    const id = await readyStudy(auth);
    await pay(auth, id, { method: 'invoice' }).expect(201);
    const v = (await api.post(`/api/surveys/${id}/launch/cancel-invoice`).set(auth).expect(200)).body.data;
    expect(v.launchStage).toBe('none');
    await api.put(`/api/surveys/${id}/plan/pay`).set(auth).send({ data: { places: 5 } }).expect(200);
  });

  it('credit pays first; if it covers everything, our check starts at once', async () => {
    const me = await mongoose.connection.collection('researchers').findOne({ email: 'kemi5@ufl.edu' });
    await TransactionModel.create({ ownerId: me!._id, ownerType: 'researcher', kind: 'credit', status: 'available', amount: 20000, currency: 'NGN', description: 'Returned from a closed study' });
    const id = await readyStudy(auth);
    expect((await api.get(`/api/surveys/${id}/launch`).set(auth).expect(200)).body.data.credit).toBe(20000);
    const r = await pay(auth, id, { useCredit: true }).expect(201);
    expect(r.body.data).toMatchObject({ status: 'paid', method: 'credit' });
    const v = (await api.get(`/api/surveys/${id}/launch`).set(auth).expect(200)).body.data;
    expect(v).toMatchObject({ launchStage: 'checking', paidIn: 11800, credit: 8200 });
  });

  it('if we can’t run it, card money is refunded and credit comes back', async () => {
    const id = await readyStudy(auth, 20); // 23,600: 8,200 credit + 15,400 card
    const r = await pay(auth, id, { useCredit: true }).expect(201);
    expect(r.body.data.amount).toBe(15400);
    await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(auth).expect(200);
    await reject(id, 'This study asks participants for bank details.');
    expect(await FundingModel.findById(r.body.data.fundingId)).toMatchObject({ status: 'refunded' });
    const v = (await api.get(`/api/surveys/${id}/launch`).set(auth).expect(200)).body.data;
    expect(v).toMatchObject({ launchStage: 'rejected', credit: 8200 });
    expect(lastMail('kemi5@ufl.edu', /can’t run your study/)!.text).toMatch(/refunded within 14 days/);
  });

  it('a study set to open later stays hidden until that day', async () => {
    const id = await readyStudy(auth, 5, { opens: 'date', opensAt: '2099-01-01' });
    const r = await pay(auth, id, { useCredit: false }).expect(201);
    await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(auth).expect(200);
    await approve(id);
    const p = await ParticipantModel.create({ email: 'p6@example.com', firstName: 'P', password: 'x-not-used-1', isVerified: true, isCompleteProfile: true, profile: { countryOfResidence: 'Nigeria', dateOfBirth: new Date(1990, 0, 1) } });
    const pAuth = { Authorization: `Bearer ${signAccessToken({ id: String(p._id), userType: 'participant' } as any)}` };
    const list = await api.get('/api/surveys/get-all-surveys').set(pAuth).expect(200);
    expect(list.body.data.map((x: any) => x.surveyId)).not.toContain(id);
    await api.get(`/api/surveys/check-eligibility/${id}`).set(pAuth).expect(403);
  });
});

describe('Stripe webhook', () => {
  const sign = (body: string, secret = 'whsec_test') => {
    const t = Math.floor(Date.now() / 1000);
    return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
  };
  it('refuses a bad signature and marks the payment paid on a good one', async () => {
    const s: any = await SurveyModel.findOne({ launchStage: 'none', status: 'draft' });
    const f = await FundingModel.create({ surveyId: s._id, researcherId: s.userId, method: 'card', amount: 100, currency: 'NGN', provider: 'stripe', providerRef: 'pi_123', receipt: { email: 'x@example.com' } });
    const body = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_123' } } });
    await api.post('/api/billing/webhook').set('Content-Type', 'application/json').set('stripe-signature', sign(body, 'wrong')).send(body).expect(400);
    await api.post('/api/billing/webhook').set('Content-Type', 'application/json').set('stripe-signature', sign(body)).send(body).expect(200);
    expect(await FundingModel.findById(f._id)).toMatchObject({ status: 'paid' });
  });
});
