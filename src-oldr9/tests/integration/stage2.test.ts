import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../app';
import { connectDB } from '../../config/database';
import { outbox } from '../../utils/mailer';
import { ResearcherModel } from '../../modules/user/models/researcher.model';
import { feeRateFor, reviewVerification } from '../../modules/user/services/setup.service';
import { isAcademicDomain } from '../../utils/academic';

/** Stage 2: "Tell us about your work" (2.1) and "Verify your institution" (2.2). */
const api = request(app);
const PASS = 'research-pass-1';

const lastMail = (to: string, re: RegExp) => [...outbox].reverse().find((m) => m.to === to && re.test(m.subject));

/** Signs up and confirms a researcher; returns their access token. */
async function researcher(email: string, fullName = 'Ada Obi', method?: string) {
  await api.post('/api/researchers/auth/register').send({ fullName, email, password: PASS, method }).expect(201);
  const url = new URL(lastMail(email, /verify/i)!.text.match(/https?:\/\/\S+/)![0]);
  const res = await api.get('/api/researchers/auth/verify-email').query({ email, token: url.searchParams.get('token') }).expect(200);
  return { Authorization: `Bearer ${res.body.data.accessToken}` };
}

const profile = (over: Record<string, unknown> = {}) => ({
  organizationType: 'university',
  organizationName: 'University of Lagos',
  country: 'Nigeria',
  role: 'Professor or principal investigator',
  researchAreas: ['Political science'],
  firstMethod: 'interview',
  ...over,
});

beforeAll(async () => {
  await connectDB(process.env.MONGO_URI!.replace(/\/[^/]*$/, '/joinstudy_stage2_test'));
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('academic email domains', () => {
  it('recognises common patterns, a starter list, and nothing else', () => {
    for (const d of ['ada@ufl.edu', 'x@unilag.edu.ng', 'x@ox.ac.uk', 'x@uct.ac.za', 'x@cmail.carleton.ca', 'x@uottawa.ca']) expect(isAcademicDomain(d)).toBe(true);
    for (const d of ['x@gmail.com', 'x@education.com', 'x@ngo.org', 'x@edu.com']) expect(isAcademicDomain(d)).toBe(false);
  });
});

describe('2.1 tell us about your work', () => {
  it('needs where they work and their country, and names the organisation unless independent', async () => {
    const auth = await researcher('chi@gmail.com', 'Chi Eze');
    const noCountry = await api.put('/api/researchers/me/profile').set(auth).send(profile({ country: '' })).expect(400);
    expect(noCountry.body.message).toMatch(/country/i);
    const noOrg = await api.put('/api/researchers/me/profile').set(auth).send(profile({ organizationName: '' })).expect(400);
    expect(noOrg.body.message).toMatch(/organisation's name/);
    const badType = await api.put('/api/researchers/me/profile').set(auth).send(profile({ organizationType: 'UI/UX' })).expect(400);
    expect(badType.body.message).toMatch(/where you work/);
    const ok = await api.put('/api/researchers/me/profile').set(auth).send(profile({ organizationType: 'independent', organizationName: '' })).expect(200);
    expect(ok.body.data).toMatchObject({ next: 'dashboard', user: { isCompleteProfile: true, organizationType: 'independent', country: 'Nigeria' } });
  });

  it('a university email verifies at once', async () => {
    const auth = await researcher('ada@ufl.edu', 'Ada Obi', 'interview');
    const res = await api.put('/api/researchers/me/profile').set(auth).send(profile()).expect(200);
    expect(res.body.data.next).toBe('dashboard');
    expect(res.body.data.user.institutionVerification).toMatchObject({ status: 'verified', method: 'sign-in-email', email: 'ada@ufl.edu' });
    expect(res.body.data.user.signupIntent.method).toBe('interview');
  });

  it('companies are not offered verification', async () => {
    const auth = await researcher('pm@startup.io', 'Pat Ma');
    const res = await api.put('/api/researchers/me/profile').set(auth).send(profile({ organizationType: 'company', organizationName: 'Startup' })).expect(200);
    expect(res.body.data.next).toBe('dashboard');
    const no = await api.post('/api/researchers/me/verification/email').set(auth).send({ email: 'pm@startup.io' }).expect(400);
    expect(no.body.code).toBe('not_eligible');
  });

  it('a study cannot go live until setup is done', async () => {
    const auth = await researcher('new@gmail.com', 'New Person');
    const p = await api.post('/api/projects/create-project').set(auth).send({ title: 'First' }).expect(201);
    const s = await api.post('/api/surveys/create-draft-survey').set(auth).send({ projectId: p.body.data._id, surveyName: 'Pilot' }).expect(201);
    const res = await api.post(`/api/surveys/publish-draft-survey/${s.body.data.surveyId}`).set(auth).expect(403);
    expect(res.body.code).toBe('setup_incomplete');
  });
});

describe('2.2 verify your institution', () => {
  let auth: { Authorization: string };

  it('asks to verify when the sign-in email is not recognised', async () => {
    auth = await researcher('tolu@gmail.com', 'Tolu Ade');
    const res = await api.put('/api/researchers/me/profile').set(auth).send(profile({ organizationType: 'nonprofit', organizationName: 'Health Access NGO' })).expect(200);
    expect(res.body.data.next).toBe('verify');
    expect(res.body.data.user.institutionVerification.status).toBe('none');
  });

  it('a work email at an NGO proves the address, then goes for review', async () => {
    const sent = await api.post('/api/researchers/me/verification/email').set(auth).send({ email: 'tolu@healthaccess.org' }).expect(200);
    expect(sent.body.data).toMatchObject({ email: 'tolu@healthaccess.org', academic: false });
    const soon = await api.post('/api/researchers/me/verification/email').set(auth).send({ email: 'tolu@healthaccess.org' }).expect(429);
    expect(soon.body.code).toBe('too_soon');
    const wrong = await api.post('/api/researchers/me/verification/email/confirm').set(auth).send({ code: '000000' }).expect(400);
    expect(wrong.body.code).toBe('wrong_code');
    const code = lastMail('tolu@healthaccess.org', /verification code/)!.text.match(/\b(\d{6})\b/)![1];
    const ok = await api.post('/api/researchers/me/verification/email/confirm').set(auth).send({ code }).expect(200);
    expect(ok.body.data.status).toBe('pending');
    const me = await api.get('/api/researchers/me').set(auth).expect(200);
    expect(me.body.data.institutionCode).toBeUndefined();
    expect(me.body.data.institutionVerification).toMatchObject({ status: 'pending', method: 'work-email' });
  });

  it('an academic work email verifies at once', async () => {
    const a = await researcher('kemi@gmail.com', 'Kemi Bello');
    await api.put('/api/researchers/me/profile').set(a).send(profile()).expect(200);
    await api.post('/api/researchers/me/verification/email').set(a).send({ email: 'kbello@unilag.edu.ng' }).expect(200);
    const code = lastMail('kbello@unilag.edu.ng', /verification code/)!.text.match(/\b(\d{6})\b/)![1];
    const ok = await api.post('/api/researchers/me/verification/email/confirm').set(a).send({ code }).expect(200);
    expect(ok.body.data.status).toBe('verified');
  });

  it('a staff page goes for review, and a reviewer can approve it', async () => {
    const a = await researcher('ifeoma@yahoo.com', 'Ifeoma Nwosu');
    await api.put('/api/researchers/me/profile').set(a).send(profile({ organizationType: 'institute', organizationName: 'Policy Lab' })).expect(200);
    const bad = await api.post('/api/researchers/me/verification/link').set(a).send({ url: 'javascript:alert(1)' }).expect(400);
    expect(bad.body.message).toMatch(/https/);
    const res = await api.post('/api/researchers/me/verification/link').set(a).send({ url: 'https://policylab.example/people/ifeoma' }).expect(200);
    expect(res.body.data.status).toBe('pending');
    expect(await feeRateFor(String((await ResearcherModel.findOne({ email: 'ifeoma@yahoo.com' }))!._id))).toBeCloseTo(0.2);
    await reviewVerification('ifeoma@yahoo.com', 'verified');
    expect(await feeRateFor(String((await ResearcherModel.findOne({ email: 'ifeoma@yahoo.com' }))!._id))).toBeCloseTo(0.18);
  });
});

describe('pricing', () => {
  it('publishes the standard and academic fee', async () => {
    const res = await api.get('/api/pricing').expect(200);
    expect(res.body.data).toMatchObject({ platformFeeRate: 0.2, academicFeeRate: 0.18 });
  });

  it('a verified university researcher is charged the academic fee', async () => {
    const id = String((await ResearcherModel.findOne({ email: 'ada@ufl.edu' }))!._id);
    expect(await feeRateFor(id)).toBeCloseTo(0.18);
    const company = String((await ResearcherModel.findOne({ email: 'pm@startup.io' }))!._id);
    expect(await feeRateFor(company)).toBeCloseTo(0.2);
  });
});
