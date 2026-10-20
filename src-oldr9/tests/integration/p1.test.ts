import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../app';
import { connectDB } from '../../config/database';
import { env } from '../../config/env';
import { outbox } from '../../utils/mailer';
import { ParticipantModel } from '../../modules/user/models/participant.model';
import { LeadModel } from '../../modules/leads/lead.model';
import { approve } from '../../modules/billing/launch.service';
import { lastTestCode } from '../../modules/verification/providers';
import { decideReview, normalisePhone } from '../../modules/verification/verification.service';
import { newParticipantExtras } from '../../modules/user/services/account.service';

/** Participant Stage 1: join, sign up free, confirm email, then verify once before the first study. */
const api = request(app);
const PASS = 'amaka-pass-1';
const lastMail = (to: string, re: RegExp) => [...outbox].reverse().find((m) => m.to.includes(to) && re.test(m.subject));
type Auth = { Authorization: string };

const SIGNUP = { firstName: 'Amaka', lastName: 'Eze', password: PASS, country: 'Nigeria', agree: true };

async function signUpAndConfirm(email: string, extra: Record<string, unknown> = {}): Promise<Auth & { id: string }> {
  await api.post('/api/participants/auth/register').send({ ...SIGNUP, email, ...extra }).expect(201);
  const url = new URL(lastMail(email, /verify/i)!.text.match(/https?:\/\/\S+/)![0]);
  const res = await api.get('/api/participants/auth/verify-email').query({ email, token: url.searchParams.get('token') }).expect(200);
  return { Authorization: `Bearer ${res.body.data.accessToken}`, id: String(res.body.data.user._id) };
}
async function completeProfile(p: Auth) {
  await api.post('/api/participants/auth/complete-profile').set(p).send({ countryOfResidence: 'Nigeria', dob_day: '2', dob_month: '5', dob_year: '1994', gender: 'Female' }).expect(200);
}
const V = '/api/participants/me/verification';
async function verifyFully(p: Auth, phone: string) {
  await api.post(`${V}/consent`).set(p).expect(200);
  await api.post(`${V}/phone/send`).set(p).send({ phone, channel: 'whatsapp' }).expect(200);
  await api.post(`${V}/phone/verify`).set(p).send({ code: lastTestCode(normalisePhone(phone, 'Nigeria')) }).expect(200);
  const s = await api.post(`${V}/selfie/start`).set(p).expect(200);
  return api.post(`${V}/selfie/complete`).set(p).send({ session: s.body.data.session, testOutcome: 'verified' }).expect(200);
}

async function researcher(email: string): Promise<Auth> {
  await api.post('/api/researchers/auth/register').send({ fullName: 'Ada Obi', email, password: 'research-pass-1' }).expect(201);
  const url = new URL(lastMail(email, /verify/i)!.text.match(/https?:\/\/\S+/)![0]);
  const res = await api.get('/api/researchers/auth/verify-email').query({ email, token: url.searchParams.get('token') }).expect(200);
  const auth = { Authorization: `Bearer ${res.body.data.accessToken}` };
  await api.put('/api/researchers/me/profile').set(auth).send({ organizationType: 'university', organizationName: 'University of Florida', country: 'United States' }).expect(200);
  return auth;
}
async function liveSurvey(auth: Auth, title: string, perPerson: number) {
  const s = await api.post('/api/surveys/start').set(auth).send({ method: 'survey' }).expect(201);
  const id = s.body.data.surveyId as string;
  const plan: Record<string, object> = {
    basics: { title, description: 'A short study for this test.', consent: { mode: 'own', text: '' } },
    audience: { countries: ['Nigeria'], minAge: 18, maxAge: 100 },
    setup: { url: 'https://forms.example/p1', minutes: 15, devices: ['phone'] },
    pay: { perPerson, places: 10 },
  };
  for (const step of ['basics', 'audience', 'setup', 'pay']) await api.put(`/api/surveys/${id}/plan/${step}`).set(auth).send({ data: plan[step], final: true }).expect(200);
  const r = await api.post(`/api/surveys/${id}/launch/pay`).set(auth).send({ method: 'card', agree: true, receipt: { name: 'Ada Obi', email: 'ada.p1@ufl.edu', country: 'United States' } }).expect(201);
  await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(auth).expect(200);
  await approve(id);
  return id;
}

beforeAll(async () => {
  env.REQUIRE_PARTICIPANT_VERIFICATION = true;
  await connectDB(process.env.MONGO_URI!.replace(/\/[^/]*$/, '/joinstudy_p1_test'));
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  env.REQUIRE_PARTICIPANT_VERIFICATION = false;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('1.1–1.2 joining and signing up', () => {
  it('outside Nigeria, Ghana and Kenya: the waitlist, not an account', async () => {
    const r = await api.post('/api/participants/auth/register').send({ ...SIGNUP, email: 'zola@example.com', country: 'South Africa' }).expect(400);
    expect(r.body.message).toMatch(/Nigeria, Ghana and Kenya/);
    await api.post('/api/participants/waitlist').send({ email: 'zola@example.com', country: 'South Africa' }).expect(201);
    const lead = await LeadModel.findOne({ email: 'zola@example.com' });
    expect(lead?.get('type')).toBe('participant-waitlist');
    expect(lead?.get('country')).toBe('South Africa');
  });

  it('needs the 18+/terms box, 8 characters, a real inbox and a country', async () => {
    const no = await api.post('/api/participants/auth/register').send({ ...SIGNUP, email: 'a@example.com', agree: false }).expect(400);
    expect(no.body.message).toMatch(/18 or older/);
    const short = await api.post('/api/participants/auth/register').send({ ...SIGNUP, email: 'a@example.com', password: 'short1' }).expect(400);
    expect(short.body.message).toMatch(/8 characters/);
    const temp = await api.post('/api/participants/auth/register').send({ ...SIGNUP, email: 'a@mailinator.com' }).expect(400);
    expect(temp.body.message).toMatch(/Temporary inboxes/);
    const { country: _c, ...noCountry } = SIGNUP;
    const nc = await api.post('/api/participants/auth/register').send({ ...noCountry, email: 'a@example.com' }).expect(400);
    expect(nc.body.message).toMatch(/where you live/);
  });

  it('stores the country and when they agreed; no phone or ID at sign-up', async () => {
    await api.post('/api/participants/auth/register').send({ ...SIGNUP, email: 'kofi@example.com', country: 'Ghana' }).expect(201);
    const p: any = await ParticipantModel.findOne({ email: 'kofi@example.com' });
    expect(p.country).toBe('Ghana');
    expect(p.agreedTermsAt).toBeInstanceOf(Date);
    expect(p.verification.status).toBe('none');
  });

  it('Google can’t create a participant without the country and agreement', async () => {
    // Firebase isn't configured in tests, so the token check itself answers first (503).
    await api.post('/api/participants/auth/google-auth').send({ token: 'firebase-id-token' }).expect(503);
    // The rule the Google path applies once the token is checked:
    expect(() => newParticipantExtras({})).toThrow(/where you live/);
    expect(() => newParticipantExtras({ country: 'Nigeria' })).toThrow(/agree/);
    expect(() => newParticipantExtras({ country: 'Togo', agree: true })).toThrow();
    expect(newParticipantExtras({ country: 'Kenya', agree: true })).toMatchObject({ country: 'Kenya' });
  });
});

describe('1.3–1.4 confirming the email', () => {
  it('fixes a mistyped email before confirming, and the link goes to the new one', async () => {
    await api.post('/api/participants/auth/register').send({ ...SIGNUP, email: 'amaka@exmaple.com' }).expect(201);
    await api.post('/api/participants/auth/change-email').send({ email: 'amaka@exmaple.com', password: 'wrong-pass-1', newEmail: 'amaka@example.com' }).expect(401);
    await api.post('/api/participants/auth/change-email').send({ email: 'amaka@exmaple.com', password: PASS, newEmail: 'amaka@example.com' }).expect(200);
    expect(lastMail('amaka@example.com', /verify/i)).toBeTruthy();
    expect(await ParticipantModel.exists({ email: 'amaka@exmaple.com' })).toBeNull();
    // Resend works on the participant path (it used to fail in the browser).
    await api.post('/api/auth/resend-verification').send({ email: 'amaka@example.com' }).expect(429);
  });

  it('the link confirms and signs in; signing in before confirming says so', async () => {
    const login = await api.post('/api/auth/login').send({ email: 'amaka@example.com', password: PASS }).expect(403);
    expect(login.body.code ?? login.body.error).toBeTruthy();
    const url = new URL(lastMail('amaka@example.com', /verify/i)!.text.match(/https?:\/\/\S+/)![0]);
    expect(url.pathname).toBe('/auth/verify-email');
    const res = await api.get('/api/participants/auth/verify-email').query({ email: 'amaka@example.com', token: url.searchParams.get('token') }).expect(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });
});

describe('1.7–1.9 verified once, before the first study', () => {
  let ada: Auth;
  let s1: string;
  let s2: string;
  beforeAll(async () => {
    ada = await researcher('ada.p1@ufl.edu');
    s1 = await liveSurvey(ada, 'How Lagos commuters get to work', 1500);
    s2 = await liveSurvey(ada, 'Mobile money habits at home', 1000);
  });

  it('only asks once they qualify: counts the open studies that fit', async () => {
    const p = await signUpAndConfirm('bola@example.com');
    const before = await api.get(V).set(p).expect(200);
    expect(before.body.data.qualifying.count).toBe(0); // no profile yet
    await completeProfile(p);
    const after = await api.get(V).set(p).expect(200);
    expect(after.body.data).toMatchObject({ required: true, status: 'none', callingCode: '234' });
    expect(after.body.data.qualifying).toMatchObject({ count: 2, minPay: 1000, maxPay: 1500 });
  });

  it('blocks studies until verified', async () => {
    const p = await signUpAndConfirm('chidi@example.com');
    await completeProfile(p);
    const r = await api.get(`/api/surveys/check-eligibility/${s1}`).set(p).expect(403);
    expect(r.body.message).toMatch(/Get verified once/);
  });

  it('WhatsApp code: consent first, one number per account, wrong codes counted', async () => {
    const p = await signUpAndConfirm('dayo@example.com');
    await api.post(`${V}/phone/send`).set(p).send({ phone: '0803 555 0142' }).expect(409); // consent first
    await api.post(`${V}/consent`).set(p).expect(200);
    await api.post(`${V}/phone/send`).set(p).send({ phone: '+233 24 555 0142' }).expect(400); // not a Nigerian number
    const sent = await api.post(`${V}/phone/send`).set(p).send({ phone: '0803 555 0142', channel: 'whatsapp' }).expect(200);
    expect(sent.body.data.sentTo).toMatch(/42$/);
    await api.post(`${V}/phone/send`).set(p).send({ phone: '0803 555 0142', channel: 'sms' }).expect(429); // 30-second gap
    await api.post(`${V}/phone/verify`).set(p).send({ code: '000000' }).expect(400);
    await api.post(`${V}/phone/verify`).set(p).send({ code: lastTestCode('+2348035550142') }).expect(200);

    const stored: any = await ParticipantModel.findOne({ email: 'dayo@example.com' }).select('+verification.phoneHash');
    expect(stored.verification.phoneLast2).toBe('42');
    expect(stored.verification.phoneHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored.toObject())).not.toContain('8035550142'); // the number itself is never stored
    const me = await api.get('/api/participants/me').set(p).expect(200);
    expect(JSON.stringify(me.body.data)).not.toMatch(/phoneHash|pending/);

    const other = await signUpAndConfirm('dayo2@example.com');
    await api.post(`${V}/consent`).set(other).expect(200);
    const taken = await api.post(`${V}/phone/send`).set(other).send({ phone: '+234 803 555 0142' }).expect(409);
    expect(taken.body.message).toMatch(/already on another joinStudy account/);
  });

  it('selfie: verified once, then studies open, and it is never asked again', async () => {
    const p = await signUpAndConfirm('efe@example.com');
    await completeProfile(p);
    await api.post(`${V}/selfie/start`).set(p).expect(409); // phone first
    const r = await verifyFully(p, '0803 555 0199');
    expect(r.body.data.status).toBe('verified');
    await api.get(`/api/surveys/check-eligibility/${s1}`).set(p).expect(200);
    await api.post(`${V}/selfie/start`).set(p).expect(409); // already done, for good
    await api.get(`/api/surveys/check-eligibility/${s2}`).set(p).expect(200); // a second study needs nothing more
  });

  it('three failed selfies go to a person; their decision is emailed', async () => {
    const p = await signUpAndConfirm('funmi@example.com');
    await api.post(`${V}/consent`).set(p).expect(200);
    await api.post(`${V}/phone/send`).set(p).send({ phone: '0803 555 0177' }).expect(200);
    await api.post(`${V}/phone/verify`).set(p).send({ code: lastTestCode('+2348035550177') }).expect(200);
    for (let i = 0; i < 3; i++) {
      const s = await api.post(`${V}/selfie/start`).set(p).expect(200);
      await api.post(`${V}/selfie/complete`).set(p).send({ session: s.body.data.session, testOutcome: 'retry' }).expect(200);
    }
    const st = await api.get(V).set(p).expect(200);
    expect(st.body.data.status).toBe('review');
    expect(lastMail(env.REVIEW_INBOX || env.LEADS_INBOX, /verification to review/)).toBeTruthy();
    await decideReview('funmi@example.com', 'approve');
    expect((await api.get(V).set(p)).body.data.status).toBe('verified');
    expect(lastMail('funmi@example.com', /verified/i)).toBeTruthy();
  });

  it('a face already on another account: this account can’t take studies', async () => {
    const p = await signUpAndConfirm('gbenga@example.com');
    await completeProfile(p);
    await api.post(`${V}/consent`).set(p).expect(200);
    await api.post(`${V}/phone/send`).set(p).send({ phone: '0803 555 0166' }).expect(200);
    await api.post(`${V}/phone/verify`).set(p).send({ code: lastTestCode('+2348035550166') }).expect(200);
    const s = await api.post(`${V}/selfie/start`).set(p).expect(200);
    const r = await api.post(`${V}/selfie/complete`).set(p).send({ session: s.body.data.session, testOutcome: 'duplicate' }).expect(200);
    expect(r.body.data.status).toBe('duplicate');
    const block = await api.get(`/api/surveys/check-eligibility/${s1}`).set(p).expect(403);
    expect(block.body.message).toMatch(/matches another joinStudy account/);
  });

  it('a stale selfie session can’t be replayed', async () => {
    const p = await signUpAndConfirm('hauwa@example.com');
    await api.post(`${V}/consent`).set(p).expect(200);
    await api.post(`${V}/phone/send`).set(p).send({ phone: '0803 555 0155' }).expect(200);
    await api.post(`${V}/phone/verify`).set(p).send({ code: lastTestCode('+2348035550155') }).expect(200);
    await api.post(`${V}/selfie/complete`).set(p).send({ session: 'made-up-session-id', testOutcome: 'verified' }).expect(409);
  });

  it('with verification switched off, studies stay open as before', async () => {
    env.REQUIRE_PARTICIPANT_VERIFICATION = false;
    const p = await signUpAndConfirm('ike@example.com');
    await completeProfile(p);
    await api.get(`/api/surveys/check-eligibility/${s1}`).set(p).expect(200);
    env.REQUIRE_PARTICIPANT_VERIFICATION = true;
  });
});
