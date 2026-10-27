import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../app';
import { connectDB } from '../../config/database';
import { outbox } from '../../utils/mailer';
import { ResearcherModel } from '../../modules/user/models/researcher.model';

/**
 * Stage 1 of the researcher flow: sign up on one screen, confirm by email (which signs you in),
 * one sign-in page for everyone, password reset. Screens: the "joinStudy Researcher Flow" canvas.
 */
const api = request(app);
const PASS = 'research-pass-1';

const lastMail = (to: string, re: RegExp) => [...outbox].reverse().find((m) => m.to === to && re.test(m.subject));
const linkFor = (to: string) => {
  const url = new URL(lastMail(to, /verify/i)!.text.match(/https?:\/\/\S+/)![0]);
  return { path: url.pathname, email: url.searchParams.get('email')!, token: url.searchParams.get('token')! };
};
const codeFor = (to: string) => lastMail(to, /code/i)!.text.match(/\b(\d{6})\b/)![1];
const allowResend = (email: string) => ResearcherModel.updateOne({ email }, { $set: { verificationSentAt: new Date(Date.now() - 120_000) } });

beforeAll(async () => {
  await connectDB(process.env.MONGO_URI!.replace(/\/[^/]*$/, '/joinstudy_stage1_test'));
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('1.2 sign up on one screen', () => {
  it('needs only full name, email and password, and remembers the method', async () => {
    const res = await api
      .post('/api/researchers/auth/register')
      .send({ fullName: 'Ada  Nkem Obi', email: 'Ada@Uni.edu', password: PASS, receivesUpdates: true, method: 'interview', source: 'method-card' })
      .expect(201);
    expect(res.body.data).toMatchObject({ firstName: 'Ada', lastName: 'Nkem Obi', email: 'ada@uni.edu', receivesUpdates: true, signupIntent: { method: 'interview', source: 'method-card' } });
    expect(res.body.data.password).toBeUndefined();
    expect(res.body.data.verificationSentAt).toBeUndefined();
  });

  it('accepts a single name', async () => {
    const res = await api.post('/api/researchers/auth/register').send({ fullName: 'Chidinma', email: 'chi@uni.edu', password: PASS }).expect(201);
    expect(res.body.data).toMatchObject({ firstName: 'Chidinma', lastName: '' });
  });

  it('explains what is wrong', async () => {
    const short = await api.post('/api/researchers/auth/register').send({ fullName: 'A B', email: 'x@uni.edu', password: 'short' }).expect(400);
    expect(short.body.message).toMatch(/8 characters/);
    const noName = await api.post('/api/researchers/auth/register').send({ fullName: ' ', email: 'y@uni.edu', password: PASS }).expect(400);
    expect(noName.body.message).toMatch(/name/i);
    const taken = await api.post('/api/researchers/auth/register').send({ fullName: 'Ada Obi', email: 'ada@uni.edu', password: PASS }).expect(409);
    expect(taken.body.code).toBe('email_taken');
  });
});

describe('1.3 check your email', () => {
  it('limits resends to one a minute, without revealing whether an account exists', async () => {
    const soon = await api.post('/api/auth/resend-verification').send({ email: 'ada@uni.edu' }).expect(429);
    expect(soon.body.code).toBe('too_soon');
    expect(soon.body.data.retryAfter).toBeGreaterThan(0);
    await api.post('/api/auth/resend-verification').send({ email: 'nobody@uni.edu' }).expect(200);
    await allowResend('ada@uni.edu');
    const before = outbox.length;
    await api.post('/api/auth/resend-verification').send({ email: 'ada@uni.edu' }).expect(200);
    expect(outbox.length).toBe(before + 1);
  });
});

describe('1.4 email confirmed', () => {
  it('confirms and signs in with the newest link', async () => {
    const link = linkFor('ada@uni.edu');
    expect(link.path).toBe('/auth/researcher/verify-email');
    const res = await api.get('/api/researchers/auth/verify-email').query(link).expect(200);
    expect(res.body.data).toMatchObject({ alreadyVerified: false, userType: 'researcher' });
    expect(res.body.data.accessToken).toBeTruthy();
    const me = await api.get('/api/researchers/me').set('Authorization', `Bearer ${res.body.data.accessToken}`).expect(200);
    expect(me.body.data.isVerified).toBe(true);
  });

  it('does not sign in twice with the same link', async () => {
    const res = await api.get('/api/researchers/auth/verify-email').query(linkFor('ada@uni.edu')).expect(200);
    expect(res.body.data.alreadyVerified).toBe(true);
    expect(res.body.data.accessToken).toBeUndefined();
  });

  it('says when a link has expired, and a new one works', async () => {
    const link = linkFor('chi@uni.edu');
    await ResearcherModel.updateOne({ email: 'chi@uni.edu' }, { $set: { verificationTokenExpires: new Date(Date.now() - 1000) } });
    const res = await api.get('/api/researchers/auth/verify-email').query(link).expect(410);
    expect(res.body.code).toBe('link_expired');
    await allowResend('chi@uni.edu');
    await api.post('/api/auth/resend-verification').send({ email: 'chi@uni.edu' }).expect(200);
    await api.get('/api/researchers/auth/verify-email').query(linkFor('chi@uni.edu')).expect(200);
  });

  it('rejects a tampered link', async () => {
    const res = await api.get('/api/researchers/auth/verify-email').query({ email: 'nobody@uni.edu', token: 'x'.repeat(20) }).expect(400);
    expect(res.body.code).toBe('invalid_link');
  });
});

describe('1.5 one sign-in for everyone', () => {
  it('signs a researcher in without asking the account type', async () => {
    const res = await api.post('/api/auth/login').send({ email: 'ADA@uni.edu', password: PASS }).expect(200);
    expect(res.body.data.userType).toBe('researcher');
  });

  it('wrong password', async () => {
    const res = await api.post('/api/auth/login').send({ email: 'ada@uni.edu', password: 'nope-nope' }).expect(401);
    expect(res.body.code).toBe('wrong_credentials');
    const unknown = await api.post('/api/auth/login').send({ email: 'ghost@uni.edu', password: PASS }).expect(401);
    expect(unknown.body.code).toBe('wrong_credentials');
  });

  it('email not confirmed', async () => {
    await api.post('/api/researchers/auth/register').send({ fullName: 'New Person', email: 'new@uni.edu', password: PASS }).expect(201);
    const res = await api.post('/api/auth/login').send({ email: 'new@uni.edu', password: PASS }).expect(403);
    expect(res.body).toMatchObject({ code: 'email_not_confirmed', data: { email: 'new@uni.edu' } });
  });

  it('participant-only account when they came to run a study, and an easy way to add a researcher account', async () => {
    await api.post('/api/participants/auth/register').send({ firstName: 'Tolu', lastName: 'Ade', email: 'tolu@example.com', password: PASS, country: 'Nigeria', agree: true }).expect(201);
    await api.get('/api/participants/auth/verify-email').query({ email: 'tolu@example.com', token: new URL(lastMail('tolu@example.com', /verify/i)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token') }).expect(200);
    const res = await api.post('/api/auth/login').send({ email: 'tolu@example.com', password: PASS, intent: 'researcher' }).expect(409);
    expect(res.body).toMatchObject({ code: 'participant_only', data: { accountType: 'participant' } });
    const plain = await api.post('/api/auth/login').send({ email: 'tolu@example.com', password: PASS }).expect(200);
    expect(plain.body.data.userType).toBe('participant');
    await api.post('/api/researchers/auth/register').send({ fullName: 'Tolu Ade', email: 'tolu@example.com', password: PASS }).expect(201);
  });

  it('asks which account when one email has both', async () => {
    await api.get('/api/researchers/auth/verify-email').query(linkFor('tolu@example.com')).expect(200);
    const res = await api.post('/api/auth/login').send({ email: 'tolu@example.com', password: PASS }).expect(200);
    expect(res.body.data).toEqual({ needsChoice: true, choices: ['researcher', 'participant'] });
    const pick = await api.post('/api/auth/login').send({ email: 'tolu@example.com', password: PASS, accountType: 'participant' }).expect(200);
    expect(pick.body.data.userType).toBe('participant');
  });

  it('Google reports itself not configured instead of crashing', async () => {
    const res = await api.post('/api/auth/google').send({ token: 'firebase-id-token', intent: 'researcher' }).expect(503);
    expect(res.body.success).toBe(false);
  });
});

describe('1.6 reset password', () => {
  it('works for researchers and signs them in', async () => {
    await api.post('/api/auth/send-otp').send({ email: 'ada@uni.edu' }).expect(200);
    const wrong = await api.post('/api/auth/verify-otp').send({ email: 'ada@uni.edu', code: '000000' }).expect(400);
    expect(wrong.body.code).toBe('wrong_code');
    const ok = await api.post('/api/auth/verify-otp').send({ email: 'ada@uni.edu', code: codeFor('ada@uni.edu') }).expect(200);
    const done = await api.post('/api/auth/reset-password').send({ email: 'ada@uni.edu', token: ok.body.data.token, password: 'brand-new-pass' }).expect(200);
    expect(done.body.data).toMatchObject({ userType: 'researcher' });
    expect(done.body.data.accessToken).toBeTruthy();
    await api.post('/api/auth/login').send({ email: 'ada@uni.edu', password: 'brand-new-pass' }).expect(200);
    const again = await api.post('/api/auth/reset-password').send({ email: 'ada@uni.edu', token: ok.body.data.token, password: 'another-pass-1' }).expect(400);
    expect(again.body.code).toBe('reset_expired');
  });

  it('one code covers both accounts on the same email', async () => {
    await api.post('/api/auth/send-otp').send({ email: 'tolu@example.com' }).expect(200);
    const ok = await api.post('/api/auth/verify-otp').send({ email: 'tolu@example.com', code: codeFor('tolu@example.com') }).expect(200);
    await api.post('/api/auth/reset-password').send({ email: 'tolu@example.com', token: ok.body.data.token, password: 'shared-new-pass', intent: 'participant' }).expect(200);
    for (const accountType of ['researcher', 'participant']) {
      await api.post('/api/auth/login').send({ email: 'tolu@example.com', password: 'shared-new-pass', accountType }).expect(200);
    }
  });
});
