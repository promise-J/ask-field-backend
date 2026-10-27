import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../app';
import { config } from '../../config/env';
import { connectDB } from '../../config/database';
import { outbox } from '../../utils/mailer';
import { signAccessToken } from '../../utils/jwt';
import { ParticipantModel } from '../../modules/user/models/participant.model';
import { SurveyActionModel, SurveyModel } from '../../modules/survey/survey.model';
import { approve } from '../../modules/billing/launch.service';
import { syncPayouts, namesMatch } from '../../modules/payouts/payouts.service';
import { TransactionModel } from '../../modules/wallet/transaction.model';
import { PayoutQuoteModel } from '../../modules/payouts/quote.model';

/** Participant Stage 6: payout method checked by the provider, quotes, one cash-out at a time, sent or returned. */
const api = request(app);
const lastMail = (to: string, re: RegExp) => [...outbox].reverse().find((m) => m.to.includes(to) && re.test(m.subject));
type Auth = { Authorization: string; id: string };
let n = 0;
const ME = '/api/participants/me';
const H = (p: Auth) => ({ Authorization: p.Authorization });

async function participant(): Promise<Auth> {
  const p = await ParticipantModel.create({ email: `p6-${++n}@example.com`, firstName: 'Amaka', lastName: 'Eze', password: 'x-not-used-1', isVerified: true, country: 'Nigeria', 'verification.status': 'verified' });
  const auth = { Authorization: `Bearer ${signAccessToken({ id: String(p._id), userType: 'participant' } as any)}`, id: String(p._id) };
  const h = H(auth);
  await api.put(`${ME}/profile/where`).set(h).send({ region: 'Lagos', birthMonth: 5, birthYear: 1994, gender: 'female' }).expect(200);
  await api.put(`${ME}/profile/languages`).set(h).send({ firstLanguage: 'Igbo', languages: ['English'] }).expect(200);
  await api.put(`${ME}/profile/work`).set(h).send({ education: 'bachelor', student: 'no', work: 'self-employed', devices: ['android'] }).expect(200);
  return auth;
}

let ada: { Authorization: string };
const RESEARCHER = 'jane.p6@umich.edu';
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
  await connectDB(process.env.MONGO_URI!.replace(/\/[^/]*$/, '/joinstudy_p6_test'));
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  ada = await researcher();
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});



/** Gives the participant an approved balance directly (studies are covered by the earlier suites). */
async function balance(p: Auth, amount: number) {
  await TransactionModel.create({ ownerId: p.id, ownerType: 'participant', kind: 'earning', status: 'available', amount, currency: 'NGN', ledgerKey: `${p.id}:${Math.random()}:earning` });
}
const PM = `${ME}/payout-method`;
const bank = (account = '0123456789') => ({ method: 'bank', institution: 'GTBank', account });

describe('6.2 payout method', () => {
  it('offers the methods for their country', async () => {
    const p = await participant();
    const r = await api.get(PM).set(H(p)).expect(200);
    expect(r.body.data.options.map((o: any) => o.method)).toEqual(['bank', 'mobile-money', 'airtime', 'paypal']);
    expect(r.body.data).toMatchObject({ country: 'Nigeria', currency: 'NGN', current: null });
    const gh = await ParticipantModel.create({ email: `gh-${++n}@example.com`, firstName: 'Ama', lastName: 'Mensah', password: 'x-not-used-1', isVerified: true, country: 'Ghana' });
    const ghAuth = { Authorization: `Bearer ${signAccessToken({ id: String(gh._id), userType: 'participant' } as any)}` };
    const g = await api.get(PM).set(ghAuth).expect(200);
    expect(g.body.data.options.map((o: any) => o.method)).toEqual(['mobile-money', 'bank', 'airtime']);
  });

  it('checks the account, keeps only the last digits, and the name must match', async () => {
    const p = await participant();
    await api.put(PM).set(H(p)).send({ ...bank(), account: '12345' }).expect(400);
    await api.put(PM).set(H(p)).send({ ...bank(), institution: 'Nope Bank' }).expect(400);
    const bad = await api.put(PM).set(H(p)).send(bank('0123456700')).expect(400);
    expect(bad.body.message).toMatch(/CHIDI OKAFOR.*doesn’t match your name \(Amaka Eze\)/);
    const ok = await api.put(PM).set(H(p)).send(bank()).expect(200);
    expect(ok.body.data.current).toMatchObject({ method: 'bank', institution: 'GTBank', last4: '6789', accountName: 'AMAKA EZE' });
    const raw: any = await ParticipantModel.findById(p.id).select('+payout.accountHash').lean();
    expect(JSON.stringify(raw)).not.toContain('0123456789');
    expect(raw.payout.accountHash).toHaveLength(64);
    const me = await api.get('/api/participants/me').set(H(p)).expect(200);
    expect(JSON.stringify(me.body)).not.toMatch(/accountHash|providerRef/);
  });

  it('one payout account per person; changing it pauses cash-outs for 48 hours and emails them', async () => {
    const [a, b] = [await participant(), await participant()];
    await api.put(PM).set(H(a)).send(bank('2222222222')).expect(200);
    const taken = await api.put(PM).set(H(b)).send(bank('2222222222')).expect(409);
    expect(taken.body.message).toMatch(/already used for payouts by another joinStudy account/);
    await balance(a, 20);
    const changed = await api.put(PM).set(H(a)).send({ method: 'mobile-money', institution: 'OPay', account: '08035550142' }).expect(200);
    expect(changed.body.data.holdUntil).toBeTruthy();
    expect(lastMail((await ParticipantModel.findById(a.id))!.email, /payout method changed/)).toBeTruthy();
    const q = await api.post(`${ME}/payouts/quote`).set(H(a)).send({}).expect(400);
    expect(q.body.message).toMatch(/paused until/);
  });

  it('matches names in any order, with middle names', () => {
    expect(namesMatch('Amaka Eze', 'EZE AMAKA GRACE')).toBe(true);
    expect(namesMatch('Amaka Eze', 'AMAKA OKAFOR')).toBe(false);
  });
});

describe('6.1, 6.3–6.4 cash out', () => {
  // The test settings use a naira minimum; Stage 6's is $5.
  const before = config.minPayoutAmount;
  beforeAll(() => { (config as any).minPayoutAmount = 5; });
  afterAll(() => { (config as any).minPayoutAmount = before; });

  it('quotes the local amount, reserves the balance, and the provider sends it', async () => {
    const p = await participant();
    await balance(p, 12.5);
    await api.put(PM).set(H(p)).send(bank('5555556789')).expect(200);
    await api.post(`${ME}/payouts/quote`).set(H(p)).send({ amount: 0.5 }).expect(400); // below the minimum
    await api.post(`${ME}/payouts/quote`).set(H(p)).send({ amount: 20 }).expect(400); // more than ready
    const q = await api.post(`${ME}/payouts/quote`).set(H(p)).send({}).expect(200);
    expect(q.body.data).toMatchObject({ amount: 12.5, rate: 1550, localAmount: 19375, localCurrency: 'NGN', fee: 0 });
    const out = await api.post(`${ME}/payouts`).set(H(p)).send({ quoteId: q.body.data.quoteId }).expect(201);
    expect(out.body.data).toMatchObject({ status: 'sending', localAmount: 19375, to: { institution: 'GTBank', last4: '6789' } });
    expect(out.body.data.reference).toMatch(/^JS-PO-\d{6}$/);
    await api.post(`${ME}/payouts`).set(H(p)).send({ quoteId: q.body.data.quoteId }).expect(400); // a quote is used once
    const m = await api.get(`${ME}/money`).set(H(p)).expect(200);
    expect(m.body.data).toMatchObject({ ready: 0, onWay: 12.5 });
    await syncPayouts();
    const st = await api.get(`${ME}/payouts/${out.body.data.id}`).set(H(p)).expect(200);
    expect(st.body.data.status).toBe('sent');
    expect(lastMail((await ParticipantModel.findById(p.id))!.email, /sent$/)).toBeTruthy();
    const csv = await api.get(`${ME}/statement.csv`).set(H(p)).expect(200);
    expect(csv.text).toMatch(/Cash out to GTBank ••6789.*sent,-12\.50,NGN,19375/);
  });

  it('two cash-outs at once can’t take the same money', async () => {
    const p = await participant();
    await balance(p, 10);
    await api.put(PM).set(H(p)).send(bank('3333333333')).expect(200);
    const quotes = [];
    for (let i = 0; i < 4; i++) quotes.push((await api.post(`${ME}/payouts/quote`).set(H(p)).send({}).expect(200)).body.data.quoteId);
    const results = await Promise.all(quotes.map((quoteId) => api.post(`${ME}/payouts`).set(H(p)).send({ quoteId })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await TransactionModel.countDocuments({ ownerId: p.id, kind: 'payout' })).toBe(1);
  });

  it('a turned-down cash-out returns the money; expired quotes are refused; airtime is capped', async () => {
    const p = await participant();
    await balance(p, 30);
    await api.put(PM).set(H(p)).send(bank('4444444499')).expect(200);
    const q = await api.post(`${ME}/payouts/quote`).set(H(p)).send({ amount: 10 }).expect(200);
    const out = await api.post(`${ME}/payouts`).set(H(p)).send({ quoteId: q.body.data.quoteId }).expect(201);
    await syncPayouts();
    const st = await api.get(`${ME}/payouts/${out.body.data.id}`).set(H(p)).expect(200);
    expect(st.body.data).toMatchObject({ status: 'failed', reason: 'The account is closed.' });
    expect((await api.get(`${ME}/money`).set(H(p))).body.data).toMatchObject({ ready: 30, onWay: 0 });

    const old = await api.post(`${ME}/payouts/quote`).set(H(p)).send({ amount: 5 }).expect(200);
    await PayoutQuoteModel.updateOne({ _id: old.body.data.quoteId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await api.post(`${ME}/payouts`).set(H(p)).send({ quoteId: old.body.data.quoteId }).expect(409)).body.message).toMatch(/rate has expired/);

    await ParticipantModel.updateOne({ _id: p.id }, { $unset: { payout: 1, payoutHoldUntil: 1 } });
    await api.put(PM).set(H(p)).send({ method: 'airtime', institution: 'MTN', account: '08035550142' }).expect(200);
    await ParticipantModel.updateOne({ _id: p.id }, { $unset: { payoutHoldUntil: 1 } });
    expect((await api.post(`${ME}/payouts/quote`).set(H(p)).send({ amount: 20 }).expect(400)).body.message).toMatch(/Airtime is up to/);
    expect((await api.post(`${ME}/payouts/quote`).set(H(p)).send({}).expect(200)).body.data.amount).toBe(10);
  });
});
