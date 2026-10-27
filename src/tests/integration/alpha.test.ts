import request from 'supertest';
import mongoose from 'mongoose';
import crypto from 'crypto';
import http from 'http';
import jwt from 'jsonwebtoken';
import app from '../../app';
import { connectDB } from '../../config/database';
import { env, config, hourlyPay } from '../../config/env';
import { outbox } from '../../utils/mailer';
import { signRefreshToken } from '../../utils/jwt';
import { FundingModel } from '../../modules/billing/funding.model';
import { SurveyModel } from '../../modules/survey/survey.model';

/**
 * Alpha feedback:
 * - card payments in production mode (a real Stripe flow, with a stand-in Stripe server): confirmed by the webhook,
 *   or by asking Stripe directly when the webhook is missing; half-set-up Stripe turns cards off.
 * - sign-out after 20 minutes without activity (server side).
 * - deleting drafts.
 * - the suggested hourly pay.
 */
const api = request(app);
const PASS = 'research-pass-1';
const lastMail = (to: string, re: RegExp) => [...outbox].reverse().find((m) => m.to.includes(to) && re.test(m.subject));
type Auth = { Authorization: string };

async function researcher(email: string) {
  await api.post('/api/researchers/auth/register').send({ fullName: 'Ada Obi', email, password: PASS }).expect(201);
  const url = new URL(lastMail(email, /verify/i)!.text.match(/https?:\/\/\S+/)![0]);
  const res = await api.get('/api/researchers/auth/verify-email').query({ email, token: url.searchParams.get('token') }).expect(200);
  const auth = { Authorization: `Bearer ${res.body.data.accessToken}` };
  await api.put('/api/researchers/me/profile').set(auth).send({ organizationType: 'university', organizationName: 'University of Florida', country: 'United States' }).expect(200);
  return { auth, session: res.body.data };
}
const PLAN: any = {
  basics: { title: 'How Lagos commuters get to work', description: 'A 15-minute survey about how you get to work in Lagos.', consent: { mode: 'own', text: '' } },
  audience: { countries: ['Nigeria'], minAge: 18, maxAge: 100 },
  setup: { url: 'https://forms.example/lagos', minutes: 15, devices: ['phone'] },
  pay: { perPerson: 1000, places: 10 },
};
async function readyStudy(auth: Auth) {
  const s = await api.post('/api/surveys/start').set(auth).send({ method: 'survey' }).expect(201);
  const id = s.body.data.surveyId as string;
  for (const step of ['basics', 'audience', 'setup', 'pay']) await api.put(`/api/surveys/${id}/plan/${step}`).set(auth).send({ data: PLAN[step], final: true }).expect(200);
  return id;
}
const RECEIPT = { name: 'Ada Obi', organization: 'University of Florida', email: 'ada.alpha@ufl.edu', cc: '', reference: '', country: 'United States' };
const payCard = (auth: Auth, id: string) => api.post(`/api/surveys/${id}/launch/pay`).set(auth).send({ method: 'card', agree: true, receipt: RECEIPT });

/** A stand-in for Stripe's API: PaymentIntents that succeed when `paid` says so. */
const intents = new Map<string, { amount: number; currency: string; paid: boolean }>();
let fake: http.Server;
let seen: string[] = [];
function startFakeStripe() {
  return new Promise<string>((resolve) => {
    fake = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push(`${req.method} ${req.url}`);
        res.setHeader('content-type', 'application/json');
        if (req.headers.authorization !== `Bearer ${env.STRIPE_SECRET_KEY}`) return res.writeHead(401).end(JSON.stringify({ error: { message: 'Invalid API key' } }));
        if (req.method === 'POST' && req.url === '/v1/payment_intents') {
          const f = new URLSearchParams(body);
          const pid = `pi_fake_${intents.size + 1}`;
          intents.set(pid, { amount: Number(f.get('amount')), currency: f.get('currency')!, paid: false });
          return res.end(JSON.stringify({ id: pid, client_secret: `${pid}_secret_x`, status: 'requires_payment_method' }));
        }
        const m = /^\/v1\/payment_intents\/([^?]+)/.exec(req.url || '');
        if (req.method === 'GET' && m && intents.has(m[1])) {
          const pi = intents.get(m[1])!;
          return res.end(JSON.stringify({ id: m[1], status: pi.paid ? 'succeeded' : 'requires_payment_method', latest_charge: pi.paid ? { payment_method_details: { card: { last4: '4242' } } } : null }));
        }
        res.writeHead(404).end(JSON.stringify({ error: { message: 'Not found' } }));
      });
    });
    fake.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(fake.address() as any).port}`));
  });
}
const signed = (event: object) => {
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', env.STRIPE_WEBHOOK_SECRET!).update(`${t}.${raw}`).digest('hex');
  return { raw, header: `t=${t},v1=${sig}` };
};

const saved = { sk: env.STRIPE_SECRET_KEY, pk: env.STRIPE_PUBLISHABLE_KEY, node: env.NODE_ENV };
beforeAll(async () => {
  await connectDB(process.env.MONGO_URI!.replace(/\/[^/]*$/, '/joinstudy_alpha_test'));
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  process.env.STRIPE_API_BASE = await startFakeStripe();
});
afterAll(async () => {
  Object.assign(env, { STRIPE_SECRET_KEY: saved.sk, STRIPE_PUBLISHABLE_KEY: saved.pk, NODE_ENV: saved.node });
  delete process.env.STRIPE_API_BASE;
  fake.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('card payments in production mode', () => {
  let auth: Auth;
  beforeAll(async () => {
    ({ auth } = await researcher('ada.alpha@ufl.edu'));
  });
  afterEach(() => Object.assign(env, { STRIPE_SECRET_KEY: saved.sk, STRIPE_PUBLISHABLE_KEY: saved.pk, NODE_ENV: saved.node }));

  it('without Stripe keys in production, cards are off and an invoice still works', async () => {
    Object.assign(env, { NODE_ENV: 'production', STRIPE_SECRET_KEY: undefined, STRIPE_PUBLISHABLE_KEY: undefined });
    const id = await readyStudy(auth);
    expect((await api.get(`/api/surveys/${id}/launch`).set(auth).expect(200)).body.data.payments.cards).toBe('unavailable');
    expect((await payCard(auth, id).expect(503)).body.code).toBe('payments_unavailable');
    const inv = await api.post(`/api/surveys/${id}/launch/pay`).set(auth).send({ method: 'invoice', agree: true, receipt: RECEIPT }).expect(201);
    expect(inv.body.data).toMatchObject({ method: 'invoice', status: 'pending' });
    // The stand-in test card flow is never reachable in production.
    expect((await api.post(`/api/billing/test-confirm/${inv.body.data.fundingId}`).set(auth)).status).toBe(404);
  });

  it('with only the secret key, cards are off too (the card form needs the publishable key)', async () => {
    Object.assign(env, { NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_PUBLISHABLE_KEY: undefined });
    const id = await readyStudy(auth);
    expect((await api.get(`/api/surveys/${id}/launch`).set(auth).expect(200)).body.data.payments.cards).toBe('unavailable');
  });

  it('with both keys: Stripe takes the card, and opening the page confirms it even without the webhook', async () => {
    Object.assign(env, { NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_PUBLISHABLE_KEY: 'pk_test_fake' });
    const id = await readyStudy(auth);
    const started = (await payCard(auth, id).expect(201)).body.data;
    expect(started).toMatchObject({ method: 'card', status: 'pending', provider: 'stripe', publishableKey: 'pk_test_fake' });
    expect(started.clientSecret).toMatch(/^pi_fake_\d+_secret_/);
    const pid = started.clientSecret.split('_secret_')[0];
    // Amounts go to Stripe in cents (or kobo): 10 × 1,000 + 18% academic fee = 11,800.
    expect(intents.get(pid)).toMatchObject({ amount: 1180000, currency: env.DEFAULT_CURRENCY.toLowerCase() });

    // Not paid yet: the page keeps waiting.
    await api.get(`/api/surveys/${id}/launch`).set(auth).expect(200);
    expect(await FundingModel.findOne({ providerRef: pid })).toMatchObject({ status: 'pending' });
    // The researcher finishes on Stripe; no webhook arrives. Opening the status page asks Stripe and confirms it.
    intents.get(pid)!.paid = true;
    const v = (await api.get(`/api/surveys/${id}/launch`).set(auth).expect(200)).body.data;
    expect(v.launchStage).toBe('checking');
    const f: any = await FundingModel.findOne({ providerRef: pid });
    expect(f).toMatchObject({ status: 'paid', cardLast4: '4242' });
    expect(lastMail('ada.alpha@ufl.edu', /^Receipt/)).toBeTruthy();
  });

  it('the signed webhook confirms a payment too, once, with the card’s last digits', async () => {
    Object.assign(env, { NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_PUBLISHABLE_KEY: 'pk_test_fake' });
    const id = await readyStudy(auth);
    const pid = (await payCard(auth, id).expect(201)).body.data.clientSecret.split('_secret_')[0];
    intents.get(pid)!.paid = true;
    const ev = signed({ type: 'payment_intent.succeeded', data: { object: { id: pid } } });
    await api.post('/api/billing/webhook').set('content-type', 'application/json').set('stripe-signature', 'nope').send(ev.raw).expect(400);
    await api.post('/api/billing/webhook').set('content-type', 'application/json').set('stripe-signature', ev.header).send(ev.raw).expect(200);
    await api.post('/api/billing/webhook').set('content-type', 'application/json').set('stripe-signature', ev.header).send(ev.raw).expect(200);
    expect(await FundingModel.findOne({ providerRef: pid })).toMatchObject({ status: 'paid', cardLast4: '4242' });
    expect((await SurveyModel.findById(id))!.launchStage).toBe('checking');
  });
});

describe('sign-out after 20 minutes without activity', () => {
  it('tokens last at most 20 minutes, and renewing gives fresh ones', async () => {
    const { session } = await researcher('idle1@ufl.edu');
    for (const t of [session.accessToken, session.refreshToken]) {
      const d: any = jwt.decode(t);
      expect(d.exp - d.iat).toBeLessThanOrEqual(20 * 60);
    }
    const r = await api.get('/api/participants/auth/refresh-token').set('token', session.refreshToken).expect(200);
    expect(r.body.data.refreshToken).toBeTruthy();
    expect(r.body.data.accessToken).toBeTruthy();
  });

  it('refuses to renew a sign-in that is more than 20 minutes old, including long-lived ones issued before', async () => {
    const { session } = await researcher('idle2@ufl.edu');
    const { id } = jwt.decode(session.accessToken) as any;
    const old = jwt.sign({ id, userType: 'researcher', iat: Math.floor(Date.now() / 1000) - 21 * 60 }, config.refreshSecret, { expiresIn: '28d' });
    const r = await api.get('/api/participants/auth/refresh-token').set('token', old).expect(401);
    expect(r.body.code).toBe('signed_out_idle');
    // A recent one still works.
    await api.get('/api/participants/auth/refresh-token').set('token', signRefreshToken({ id, userType: 'researcher' })).expect(200);
  });
});

describe('the suggested hourly pay', () => {
  it('defaults to $4 minimum and $8 suggested in US dollars; a set value wins; other currencies need setting', () => {
    expect([hourlyPay(undefined, 'USD', 4), hourlyPay('', 'usd', 8)]).toEqual([4, 8]);
    expect(hourlyPay('5', 'USD', 4)).toBe(5);
    expect(hourlyPay('0', 'USD', 4)).toBeNull();
    expect(hourlyPay(undefined, 'NGN', 4)).toBeNull();
    expect(hourlyPay('5000', 'NGN', 8)).toBe(5000);
  });

  it('the planner gets the minimum and the suggestion', async () => {
    const before = { min: config.minHourlyPay, rec: config.recommendedHourlyPay };
    Object.assign(config, { minHourlyPay: 4, recommendedHourlyPay: 8 });
    try {
      const { auth } = await researcher('pay1@ufl.edu');
      const id = await readyStudy(auth);
      const v = (await api.get(`/api/surveys/${id}/plan`).set(auth).expect(200)).body.data;
      expect(v).toMatchObject({ minHourlyPay: 4, recommendedHourlyPay: 8 });
    } finally {
      Object.assign(config, { minHourlyPay: before.min, recommendedHourlyPay: before.rec });
    }
  });
});

describe('deleting a draft', () => {
  let auth: Auth;
  beforeAll(async () => {
    ({ auth } = await researcher('draft1@ufl.edu'));
  });
  afterEach(() => Object.assign(env, { STRIPE_SECRET_KEY: saved.sk, STRIPE_PUBLISHABLE_KEY: saved.pk, NODE_ENV: saved.node }));

  it('deletes an unpaid draft, and only for its owner', async () => {
    const id = await readyStudy(auth);
    const { auth: other } = await researcher('draft2@ufl.edu');
    await api.delete(`/api/surveys/${id}`).set(other).expect(404);
    await api.delete(`/api/surveys/${id}`).set(auth).expect(200);
    expect(await SurveyModel.findById(id)).toBeNull();
    await api.get(`/api/surveys/${id}/plan`).set(auth).expect(404);
  });

  it('cancels a card payment that was started but never finished', async () => {
    const id = await readyStudy(auth);
    await payCard(auth, id).expect(201); // the test card flow: pending until confirmed
    await api.delete(`/api/surveys/${id}`).set(auth).expect(200);
    expect(await FundingModel.findOne({ surveyId: id })).toMatchObject({ status: 'cancelled' });
  });

  it('keeps paid studies and asks to cancel a waiting invoice first', async () => {
    const paid = await readyStudy(auth);
    const f = (await payCard(auth, paid).expect(201)).body.data;
    await api.post(`/api/billing/test-confirm/${f.fundingId}`).set(auth).expect(200);
    expect((await api.delete(`/api/surveys/${paid}`).set(auth).expect(409)).body.code).toBe('paid');

    const inv = await readyStudy(auth);
    await api.post(`/api/surveys/${inv}/launch/pay`).set(auth).send({ method: 'invoice', agree: true, receipt: RECEIPT }).expect(201);
    const r = await api.delete(`/api/surveys/${inv}`).set(auth);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/Cancel the invoice/);
  });
});
