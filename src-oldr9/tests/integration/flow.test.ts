import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../app';
import { connectDB } from '../../config/database';
import { outbox } from '../../utils/mailer';
import { signAccessToken } from '../../utils/jwt';
import jwt from 'jsonwebtoken';

const api = request(app);
const R = { email: 'ada@lab.example', password: 'research-pass-1', firstName: 'Ada', lastName: 'Obi', organizationName: 'Lab', signupPlatform: 'email' };
const P = { email: 'tolu@example.com', password: 'secret12', firstName: 'Tolu', lastName: 'Ade', signupPlatform: 'email', receivesUpdates: true, country: 'Nigeria', agree: true };

const linkFor = (email: string) => {
  const mail = [...outbox].reverse().find((m) => m.to === email && /verify/i.test(m.subject));
  const url = new URL(mail!.text.match(/https?:\/\/\S+/)![0]);
  return { path: url.pathname, email: url.searchParams.get('email')!, token: url.searchParams.get('token')! };
};
const codeFor = (email: string) => [...outbox].reverse().find((m) => m.to === email && /code/i.test(m.subject))!.text.match(/\b(\d{6})\b/)![1];

let rToken = '';
let pToken = '';
let pRefresh = '';
let projectId = '';
let surveyId = '';
let actionId = '';

beforeAll(async () => {
  await connectDB();
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('accounts', () => {
  it('registers a researcher and hides secrets', async () => {
    const res = await api.post('/api/researchers/auth/register').send(R).expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.password).toBeUndefined();
    expect(res.body.data.verificationToken).toBeUndefined();
    expect(res.body.data.userType).toBe('researcher');
  });

  it('refuses a duplicate email with 409', async () => {
    const res = await api.post('/api/researchers/auth/register').send(R).expect(409);
    expect(res.body).toMatchObject({ success: false });
    expect(res.body.error).toMatch(/already exists/);
  });

  it('blocks login until the email is verified, then allows it', async () => {
    await api.post('/api/researchers/auth/login').send({ email: R.email, password: R.password }).expect(403);
    const link = linkFor(R.email);
    expect(link.path).toBe('/auth/researcher/verify-email');
    await api.get('/api/researchers/auth/verify-email').query({ email: link.email, token: 'wrong-token-123' }).expect(400);
    await api.get('/api/researchers/auth/verify-email').query({ email: link.email, token: link.token }).expect(200);
    await api.post('/api/researchers/auth/login').send({ email: R.email, password: 'nope-nope' }).expect(401);
    const res = await api.post('/api/researchers/auth/login').send({ email: R.email.toUpperCase(), password: R.password }).expect(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    rToken = res.body.data.accessToken;
  });

  it('registers, verifies and logs in a participant', async () => {
    const reg = await api.post('/api/participants/auth/register').send(P).expect(201);
    expect(reg.body.message).toMatch(/Check your email/);
    const link = linkFor(P.email);
    expect(link.path).toBe('/auth/verify-email');
    await api.get('/api/participants/auth/verify-email').query(link).expect(200);
    const res = await api.post('/api/participants/auth/login').send({ email: P.email, password: P.password }).expect(200);
    pToken = res.body.data.accessToken;
    pRefresh = res.body.data.refreshToken;
    const me = await api.get('/api/participants/me').set('Authorization', `Bearer ${pToken}`).expect(200);
    expect(me.body.data.email).toBe(P.email);
  });

  it('saves the researcher onboarding', async () => {
    const body = { purposeHere: ['Education'], researchType: ['Surveys'], researchInterest: ['Search'], firstName: 'Ada', lastName: 'Obi', organization: 'Lab', street: '1 Main St', city: 'Ottawa', country: 'Canada' };
    await api.post('/api/researchers/auth/complete-profile').set('Authorization', `Bearer ${rToken}`).send({ ...body, city: '' }).expect(400);
    const res = await api.post('/api/researchers/auth/complete-profile').set('Authorization', `Bearer ${rToken}`).send(body).expect(200);
    expect(res.body.data).toMatchObject({ isCompleteProfile: true, organizationName: 'Lab', address: { city: 'Ottawa' } });
  });

  it('keeps account types apart', async () => {
    await api.get('/api/researchers/me').set('Authorization', `Bearer ${pToken}`).expect(403);
    await api.get('/api/participants/me').set('Authorization', `Bearer ${rToken}`).expect(403);
  });

  it('returns the error names the frontend uses to refresh or sign out', async () => {
    const expired = jwt.sign({ id: 'x', userType: 'participant' }, 'test-secret', { expiresIn: -10 });
    const a = await api.get('/api/participants/me').set('Authorization', `Bearer ${expired}`).expect(401);
    expect(a.body.message.name).toBe('TokenExpiredError');
    const b = await api.get('/api/participants/me').set('Authorization', 'Bearer garbage').expect(401);
    expect(b.body.message.name).toBe('JsonWebTokenError');
  });

  it('refreshes an access token from the `token` header', async () => {
    const res = await api.get('/api/participants/auth/refresh-token').set('token', pRefresh).expect(200);
    expect(res.body.data.accessToken).toBeTruthy();
    // An access token is not a refresh token.
    await api.get('/api/participants/auth/refresh-token').set('token', pToken).expect(401);
  });

  it('resets a password with a 6-digit code', async () => {
    await api.post('/api/participants/auth/send-otp').send({ email: 'nobody@example.com' }).expect(200);
    await api.post('/api/participants/auth/send-otp').send({ email: P.email }).expect(200);
    await api.post('/api/participants/auth/verify-otp').send({ email: P.email, code: '000000' }).expect(400);
    const v = await api.post('/api/participants/auth/verify-otp').send({ email: P.email, code: codeFor(P.email) }).expect(200);
    await api.post('/api/participants/auth/reset-password').send({ email: P.email, token: v.body.data.token, password: 'new-secret-9' }).expect(200);
    await api.post('/api/participants/auth/reset-password').send({ email: P.email, token: v.body.data.token, password: 'again-secret-9' }).expect(400);
    await api.post('/api/participants/auth/login').send({ email: P.email, password: 'new-secret-9' }).expect(200);
  });

  it('reports Google sign-in as not configured instead of crashing', async () => {
    const res = await api.post('/api/participants/auth/google-auth').send({ token: 'firebase-id-token' }).expect(503);
    expect(res.body.success).toBe(false);
  });

  it('removed the old unauthenticated routes', async () => {
    await api.post('/api/participants/create').send(P).expect(404);
  });
});

describe('projects', () => {
  it('creates, lists, renames, pins', async () => {
    const auth = { Authorization: `Bearer ${rToken}` };
    const a = await api.post('/api/projects/create-project').set(auth).send({ title: 'Sleep study', participantView: 'Sleep' }).expect(201);
    projectId = a.body.data._id;
    await api.post('/api/projects/create-project').set(auth).send({ title: 'Other' }).expect(201);
    await api.put(`/api/projects/pin-project/${projectId}`).set(auth).expect(200);
    await api.put(`/api/projects/rename-project/${projectId}`).set(auth).send({ title: 'Sleep and mood' }).expect(200);
    const list = await api.get('/api/projects/list-user-projects').query({ page: 1, limit: 10 }).set(auth).expect(200);
    expect(list.body.data.pagination).toMatchObject({ total: 2, page: 1, limit: 10, pages: 1 });
    expect(list.body.data.data[0]).toMatchObject({ _id: projectId, title: 'Sleep and mood', pinned: true });
  });

  it("hides other researchers' projects", async () => {
    const stranger = signAccessToken({ id: new mongoose.Types.ObjectId().toString(), userType: 'researcher' });
    await api.get(`/api/projects/get-project/${projectId}`).set('Authorization', `Bearer ${stranger}`).expect(404);
  });
});

describe('studies end to end', () => {
  const R_AUTH = () => ({ Authorization: `Bearer ${rToken}` });
  const P_AUTH = () => ({ Authorization: `Bearer ${pToken}` });

  it('builds and publishes a study', async () => {
    const d = await api.post('/api/surveys/create-draft-survey').set(R_AUTH()).send({ projectId, surveyName: 'Sleep diary' }).expect(201);
    surveyId = d.body.data.surveyId;
    expect(surveyId).toBe(d.body.data._id);
    const early = await api.post(`/api/surveys/publish-draft-survey/${surveyId}`).set(R_AUTH()).expect(400);
    expect(early.body.message).toMatch(/study URL/);
    await api
      .put(`/api/surveys/update-draft-survey/${surveyId}`)
      .set(R_AUTH())
      .send({
        projectId,
        surveyType: 'external',
        surveyDescription: 'Ten minutes about your sleep.',
        contentWarning: 'None',
        surveyLabel: 'survey',
        usableDevices: ['Desktop', 'Mobile'],
        minimumAge: 18,
        maximumAge: 40,
        gender: 'Female',
        surveyURL: 'https://forms.example.com/sleep',
        numberOfParticipants: 1,
        totalSubmission: 1,
        surveyDuration: 10,
        surveyAmount: 1500,
      })
      .expect(200);
    await api.post(`/api/surveys/publish-draft-survey/${surveyId}`).set(R_AUTH()).expect(200);
    const stats = await api.get('/api/researchers/dashboard-stats').set(R_AUTH()).expect(200);
    expect(stats.body.data).toMatchObject({ activeSurveys: 1, liveSurveys: 1, draftSurveys: 0, closedSurveys: 0, researchSpent: 0 });
  });

  it('asks the participant to complete their profile before qualifying', async () => {
    const res = await api.get(`/api/surveys/check-eligibility/${surveyId}`).set(P_AUTH()).expect(403);
    expect(res.body.message).toMatch(/Complete your profile/);
  });

  it('screens on gender and age from the profile', async () => {
    await api.post('/api/participants/auth/complete-profile').set(P_AUTH()).send({ gender: 'Male', dob_day: '4', dob_month: 'Jan', dob_year: '1995' }).expect(200);
    const no = await api.get(`/api/surveys/check-eligibility/${surveyId}`).set(P_AUTH()).expect(403);
    expect(no.body.message).not.toMatch(/forbidden|something went wrong/i);
    await api.post('/api/participants/auth/complete-profile').set(P_AUTH()).send({ gender: 'Female' }).expect(200);
    const list = await api.get('/api/surveys/get-all-surveys').query({ status: 'published' }).set(P_AUTH()).expect(200);
    expect(list.body.data.map((s: any) => s.surveyId)).toContain(surveyId);
    expect(list.body.data[0].internalSurveyName).toBeUndefined();
    expect(list.body.data[0].researcher).toEqual({ name: 'Ada Obi', organization: 'Lab' });
    const ok = await api.get(`/api/surveys/check-eligibility/${surveyId}`).set(P_AUTH()).expect(200);
    expect(ok.body.data).toMatchObject({ surveyId, status: 'in-progress' });
    actionId = ok.body.data.surveyActionId;
    const again = await api.get(`/api/surveys/check-eligibility/${surveyId}`).set(P_AUTH()).expect(200);
    expect(again.body.data.surveyActionId).toBe(actionId);
  });

  it('records the submission and a pending earning', async () => {
    const res = await api.get(`/api/surveys/verify-survey-action/${surveyId}`).set(P_AUTH()).expect(200);
    expect(res.body.data.status).toBe('submitted');
    const e = await api.get('/api/participants/earnings').set(P_AUTH()).expect(200);
    expect(e.body.data).toMatchObject({ pending: 1500, available: 0, currency: 'NGN' });
    const list = await api.get('/api/surveys/get-all-surveys').query({ status: 'published' }).set(P_AUTH()).expect(200);
    expect(list.body.data).toHaveLength(0);
  });

  it('lets the researcher approve, which pays the participant and charges the researcher', async () => {
    const list = await api.get('/api/surveys/list-survey-actions').set(R_AUTH()).expect(200);
    expect(list.body.data[0]).toMatchObject({ surveyActionId: actionId, surveyId, status: 'submitted' });
    expect(typeof list.body.data[0].participantId).toBe('string');
    await api.put(`/api/surveys/approve-survey-action/${actionId}`).set(R_AUTH()).expect(200);
    await api.put(`/api/surveys/reject-survey-action/${actionId}`).set(R_AUTH()).expect(409);
    const e = await api.get('/api/participants/earnings').set(P_AUTH()).expect(200);
    expect(e.body.data).toMatchObject({ pending: 0, available: 1500, completedStudies: 1 });
    expect(e.body.data.transactions[0]).toMatchObject({ kind: 'earning', status: 'available', title: 'Sleep diary' });
    const w = await api.get('/api/researchers/wallet').set(R_AUTH()).expect(200);
    expect(w.body.data).toMatchObject({ spent: 1800, currency: 'NGN' });
    const stats = await api.get('/api/researchers/dashboard-stats').set(R_AUTH()).expect(200);
    expect(stats.body.data.researchSpent).toBe(1800); // 1500 + 20% fee
  });

  it('marks the study full after the quota', async () => {
    const other = await api.post('/api/participants/auth/register').send({ ...P, email: 'second@example.com' }).expect(201);
    expect(other.body.success).toBe(true);
    await api.get('/api/participants/auth/verify-email').query(linkFor('second@example.com')).expect(200);
    const login = await api.post('/api/participants/auth/login').send({ email: 'second@example.com', password: P.password }).expect(200);
    const auth = { Authorization: `Bearer ${login.body.data.accessToken}` };
    await api.post('/api/participants/auth/complete-profile').set(auth).send({ gender: 'Female', dob_day: '1', dob_month: 'Feb', dob_year: '1998' }).expect(200);
    const res = await api.get(`/api/surveys/check-eligibility/${surveyId}`).set(auth).expect(403);
    expect(res.body.message).toMatch(/full/);
  });

  it('pays out the available balance', async () => {
    // Participant Stage 6: a checked payout method, then a quote, then the cash-out.
    await api.post('/api/participants/me/payouts/quote').set(P_AUTH()).send({}).expect(400);
    await api.put('/api/participants/me/payout-method').set(P_AUTH()).send({ method: 'bank', institution: 'GTBank', account: '0123456789' }).expect(200);
    await api.post('/api/participants/me/payouts/quote').set(P_AUTH()).send({ amount: 5000 }).expect(400);
    const quote = await api.post('/api/participants/me/payouts/quote').set(P_AUTH()).send({}).expect(200);
    const sent = await api.post('/api/participants/me/payouts').set(P_AUTH()).send({ quoteId: String(quote.body.data.quoteId) }).expect(201);
    expect(sent.body.data.status).toBe('sending');
    expect(sent.body.data.to.last4).toBe('6789');
    const e = await api.get('/api/participants/earnings').set(P_AUTH()).expect(200);
    expect(e.body.data).toMatchObject({ available: 0, processing: 1500 });
  });

  it('refuses to delete a project with a live study', async () => {
    await api.delete(`/api/projects/delete-project/${projectId}`).set(R_AUTH()).expect(409);
  });
});

describe('public forms', () => {
  it('saves waitlist and founding-lab sign-ups idempotently', async () => {
    await api.post('/api/waitlist').send({ email: 'a@example.com' }).expect(201);
    await api.post('/api/waitlist').send({ email: 'a@example.com' }).expect(201);
    const lab = await api.post('/api/leads').send({ type: 'founding-lab', email: 'pi@uni.example', organization: 'Uni', message: 'Hi' }).expect(201);
    expect(lab.body.message).toMatch(/2 working days/);
    await api.post('/api/leads').send({ type: 'spam', email: 'x@example.com' }).expect(400);
  });

  it('returns 404 JSON for unknown routes', async () => {
    const res = await api.get('/api/nope').expect(404);
    expect(res.body.success).toBe(false);
  });
});
