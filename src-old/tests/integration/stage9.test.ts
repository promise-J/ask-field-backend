import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../app';
import { connectDB } from '../../config/database';
import { outbox } from '../../utils/mailer';
import { SurveyModel } from '../../modules/survey/survey.model';
import { FundingModel } from '../../modules/billing/funding.model';
import { MembershipModel } from '../../modules/team/membership.model';
import { ResearcherModel } from '../../modules/user/models/researcher.model';
import { studyContact } from '../../modules/team/contact';
import { approve } from '../../modules/billing/launch.service';

/** Stage 9: account. Workspaces and roles, invites, settings (name, email, password, emails, closing), billing details. */
const api = request(app);
const PASS = 'research-pass-1';
const lastMail = (to: string, re: RegExp) => [...outbox].reverse().find((m) => m.to.includes(to) && re.test(m.subject));
type Who = { auth: { Authorization: string }; id: string; email: string; refresh: string };
const inWs = (w: Who, ws: string) => ({ ...w.auth, 'X-Workspace': ws });

async function researcher(email: string, fullName: string): Promise<Who> {
  await api.post('/api/researchers/auth/register').send({ fullName, email, password: PASS }).expect(201);
  const url = new URL(lastMail(email, /verify/i)!.text.match(/https?:\/\/\S+/)![0]);
  const res = await api.get('/api/researchers/auth/verify-email').query({ email, token: url.searchParams.get('token') }).expect(200);
  const auth = { Authorization: `Bearer ${res.body.data.accessToken}` };
  await api.put('/api/researchers/me/profile').set(auth).send({ organizationType: 'university', organizationName: 'University of Lagos', country: 'Nigeria' }).expect(200);
  return { auth, id: String(res.body.data.user._id || res.body.data.user.id || (await ResearcherModel.findOne({ email }))!._id), email, refresh: res.body.data.refreshToken };
}
const inviteToken = (email: string) => new URL(lastMail(email, /invited you to/)!.text.match(/https?:\/\/\S+/)![0]).pathname.split('/').pop()!;
const PLAN = {
  basics: { title: 'How Lagos commuters get to work', description: 'A short study about getting to work in Lagos.', consent: { mode: 'own', text: '' } },
  audience: { countries: ['Nigeria'], minAge: 18, maxAge: 100 },
  setup: { url: 'https://forms.example/lagos', minutes: 15, devices: ['phone'] },
  pay: { perPerson: 1000, places: 10 },
} as Record<string, object>;
async function plannedStudy(headers: Record<string, string>) {
  const s = await api.post('/api/surveys/start').set(headers).send({ method: 'survey' }).expect(201);
  const id = s.body.data.surveyId as string;
  for (const step of ['basics', 'audience', 'setup', 'pay']) await api.put(`/api/surveys/${id}/plan/${step}`).set(headers).send({ data: PLAN[step], final: true }).expect(200);
  return id;
}
const RECEIPT = { name: 'Ada Obi', email: 'ada9@unilag.edu.ng', country: 'Nigeria' };

beforeAll(async () => {
  await connectDB(process.env.MONGO_URI!.replace(/\/[^/]*$/, '/joinstudy_stage9_test'));
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('a team workspace', () => {
  let ada: Who, tunde: Who, bisi: Who, femi: Who;
  let studyId: string;

  beforeAll(async () => {
    ada = await researcher('ada9@unilag.edu.ng', 'Ada Obi');
    tunde = await researcher('tunde9@unilag.edu.ng', 'Tunde Okafor');
    bisi = await researcher('bisi9@unilag.edu.ng', 'Bisi Adeyemi');
    femi = await researcher('femi9@gmail.com', 'Femi Bello');
  });

  it('the owner invites people by email; the email has a link that works for 7 days', async () => {
    const v = (await api.post('/api/team/invites').set(ada.auth).send({ email: 'tunde9@unilag.edu.ng', role: 'researcher' }).expect(201)).body.data;
    expect(v.invites).toEqual([expect.objectContaining({ email: 'tunde9@unilag.edu.ng', role: 'researcher', expired: false })]);
    expect(lastMail('tunde9@unilag.edu.ng', /^Ada Obi invited you to University of Lagos on joinStudy/)!.text).toMatch(/as Researcher: plan, run and review studies/);
    await api.post('/api/team/invites').set(ada.auth).send({ email: 'bisi9@unilag.edu.ng', role: 'viewer' }).expect(201);
    expect((await api.post('/api/team/invites').set(ada.auth).send({ email: 'ada9@unilag.edu.ng', role: 'admin' }).expect(409)).body.code).toBe('already_member');
  });

  it('the invite page works before signing in; only the invited account can accept', async () => {
    const token = inviteToken('tunde9@unilag.edu.ng');
    const info = (await api.get(`/api/team/invite/${token}`).expect(200)).body.data;
    expect(info).toMatchObject({ workspace: 'University of Lagos', inviter: 'Ada Obi', email: 'tunde9@unilag.edu.ng', role: 'researcher', hasAccount: true });
    expect((await api.post(`/api/team/invite/${token}/accept`).set(femi.auth).expect(403)).body.code).toBe('wrong_account');
    const r = (await api.post(`/api/team/invite/${token}/accept`).set(tunde.auth).expect(200)).body.data;
    expect(r).toMatchObject({ workspaceId: ada.id, name: 'University of Lagos', role: 'researcher' });
    expect((await api.get(`/api/team/invite/${token}`).expect(404)).body.code).toBe('invite_not_found');
    await api.post(`/api/team/invite/${inviteToken('bisi9@unilag.edu.ng')}/accept`).set(bisi.auth).expect(200);
    const ws = (await api.get('/api/researchers/me/workspaces').set(tunde.auth).expect(200)).body.data;
    expect(ws.map((w: any) => [w.name, w.role, w.own])).toEqual([['University of Lagos', 'owner', true], ['University of Lagos', 'researcher', false]]);
    expect(ws[1].ownerName).toBe('Ada Obi');
  });

  it('expired invites can’t be used; resending makes a new link', async () => {
    await api.post('/api/team/invites').set(ada.auth).send({ email: 'kemi9@unilag.edu.ng', role: 'viewer' }).expect(201);
    const old = inviteToken('kemi9@unilag.edu.ng');
    await MembershipModel.updateOne({ email: 'kemi9@unilag.edu.ng' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await api.get(`/api/team/invite/${old}`).expect(410)).body.code).toBe('invite_expired');
    const m = await MembershipModel.findOne({ email: 'kemi9@unilag.edu.ng' });
    await api.post(`/api/team/invites/${m!.id}/resend`).set(ada.auth).expect(200);
    expect((await api.get(`/api/team/invite/${inviteToken('kemi9@unilag.edu.ng')}`).expect(200)).body.data.hasAccount).toBe(false);
    await api.get(`/api/team/invite/${old}`).expect(404);
  });

  it('a researcher works on the workspace’s studies, but can’t pay or manage the team', async () => {
    const home = (await api.get('/api/researchers/me/home').set(inWs(tunde, ada.id)).expect(200)).body.data;
    expect(home.firstName).toBe('Tunde');
    studyId = await plannedStudy(inWs(tunde, ada.id));
    const s: any = await SurveyModel.findById(studyId);
    expect(String(s.userId)).toBe(ada.id);
    expect(String(s.createdBy)).toBe(tunde.id);
    expect((await api.get('/api/researchers/me/home').set(ada.auth).expect(200)).body.data.studies.map((x: any) => x.surveyId)).toContain(studyId);
    expect((await api.post(`/api/surveys/${studyId}/launch/pay`).set(inWs(tunde, ada.id)).send({ method: 'card', agree: true, receipt: RECEIPT }).expect(403)).body.code).toBe('role_forbidden');
    await api.post('/api/team/invites').set(inWs(tunde, ada.id)).send({ email: 'x@unilag.edu.ng', role: 'viewer' }).expect(403);
    await api.put('/api/researchers/me/billing').set(inWs(tunde, ada.id)).send(RECEIPT).expect(403);
    // Their own workspace is separate.
    expect((await api.get('/api/researchers/me/home').set(tunde.auth).expect(200)).body.data.studies).toEqual([]);
  });

  it('a viewer sees but changes nothing; their own settings still work', async () => {
    await api.get(`/api/surveys/${studyId}/plan`).set(inWs(bisi, ada.id)).expect(200);
    expect((await api.put(`/api/surveys/${studyId}/plan/pay`).set(inWs(bisi, ada.id)).send({ data: { places: 20 } }).expect(403)).body.message).toMatch(/Viewers can see studies/);
    await api.post('/api/surveys/start').set(inWs(bisi, ada.id)).send({ method: 'survey' }).expect(403);
    await api.put('/api/researchers/me/account').set(inWs(bisi, ada.id)).send({ firstName: 'Bisi', lastName: 'Adeyemi-Cole' }).expect(200);
  });

  it('someone not in the workspace gets nothing', async () => {
    expect((await api.get('/api/researchers/me/home').set(inWs(femi, ada.id)).expect(403)).body.code).toBe('role_forbidden');
    await api.get(`/api/surveys/${studyId}/plan`).set(femi.auth).expect(404);
  });

  it('an admin can pay; the receipt records who paid', async () => {
    const team = (await api.get('/api/researchers/me/team').set(ada.auth).expect(200)).body.data;
    expect(team.members.map((m: any) => [m.name, m.role])).toEqual([['Ada Obi', 'owner'], ['Tunde Okafor', 'researcher'], ['Bisi Adeyemi-Cole', 'viewer']]);
    const tm = team.members.find((m: any) => m.name === 'Tunde Okafor');
    await api.put(`/api/team/members/${tm.membershipId}`).set(ada.auth).send({ role: 'admin' }).expect(200);
    expect((await api.put(`/api/team/members/${tm.membershipId}`).set(inWs(tunde, ada.id)).send({ role: 'viewer' }).expect(409)).body.code).toBe('own_role');
    const r = await api.post(`/api/surveys/${studyId}/launch/pay`).set(inWs(tunde, ada.id)).send({ method: 'card', agree: true, receipt: RECEIPT }).expect(201);
    await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(inWs(tunde, ada.id)).expect(200);
    expect(String((await FundingModel.findById(r.body.data.fundingId))!.get('paidBy'))).toBe(tunde.id);
    const wallet = (await api.get('/api/researchers/wallet').set(ada.auth).expect(200)).body.data;
    expect(wallet.fundings[0].paidByName).toBe('Tunde Okafor');
  });

  it('study emails go to whoever made the study, unless they turned them off', async () => {
    const s: any = await SurveyModel.findById(studyId);
    expect(await studyContact(s, 'messages')).toBe('tunde9@unilag.edu.ng');
    await api.put('/api/researchers/me/email-prefs').set(tunde.auth).send({ messages: false }).expect(200);
    expect(await studyContact(s, 'messages')).toBeNull();
    expect(await studyContact(s, 'bookings')).toBe('tunde9@unilag.edu.ng');
    await approve(studyId);
    expect(lastMail('tunde9@unilag.edu.ng', /Your study is live/)).toBeTruthy();
  });

  it('removing someone ends their access straight away', async () => {
    const team = (await api.get('/api/researchers/me/team').set(ada.auth).expect(200)).body.data;
    const b = team.members.find((m: any) => m.role === 'viewer');
    await api.delete(`/api/team/members/${b.membershipId}`).set(ada.auth).expect(200);
    await api.get(`/api/surveys/${studyId}/plan`).set(inWs(bisi, ada.id)).expect(403);
    // Leaving works the same way.
    await api.post(`/api/team/leave/${ada.id}`).set(tunde.auth).expect(200);
    await api.get('/api/researchers/me/home').set(inWs(tunde, ada.id)).expect(403);
  });
});

describe('settings', () => {
  let me: Who;
  beforeAll(async () => { me = await researcher('chidi9@unilag.edu.ng', 'Chidi Eze'); });

  it('shows your details and email choices (news off by default)', async () => {
    const s = (await api.get('/api/researchers/me/account').set(me.auth).expect(200)).body.data;
    expect(s).toMatchObject({ firstName: 'Chidi', lastName: 'Eze', email: 'chidi9@unilag.edu.ng', hasPassword: true, emailPrefs: { bookings: true, messages: true, review: true, finish: true, news: false } });
    expect((await api.put('/api/researchers/me/account').set(me.auth).send({ firstName: '' }).expect(400)).body.message).toMatch(/first name/);
  });

  it('changing email needs your password and a click on a link sent to the new address', async () => {
    expect((await api.post('/api/researchers/me/email').set(me.auth).send({ email: 'chidi@lagoslabs.ng', password: 'nope-nope-1' }).expect(400)).body.code).toBe('wrong_password');
    expect((await api.post('/api/researchers/me/email').set(me.auth).send({ email: 'ada9@unilag.edu.ng', password: PASS }).expect(409)).body.code).toBe('email_taken');
    const s = (await api.post('/api/researchers/me/email').set(me.auth).send({ email: 'chidi@lagoslabs.ng', password: PASS }).expect(200)).body.data;
    expect(s).toMatchObject({ email: 'chidi9@unilag.edu.ng', pendingEmail: 'chidi@lagoslabs.ng' });
    expect(lastMail('chidi9@unilag.edu.ng', /email is changing/)).toBeTruthy();
    const token = new URL(lastMail('chidi@lagoslabs.ng', /Confirm your new email/)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token');
    await api.post('/api/researchers/email/confirm').send({ token: 'wrong' }).expect(410);
    await api.post('/api/researchers/email/confirm').send({ token }).expect(200);
    await api.post('/api/auth/login').send({ email: 'chidi@lagoslabs.ng', password: PASS }).expect(200);
    me.email = 'chidi@lagoslabs.ng';
  });

  it('changing the password signs out other sessions', async () => {
    expect((await api.post('/api/researchers/me/password').set(me.auth).send({ current: 'wrong-pass-1', next: 'new-pass-123' }).expect(400)).body.code).toBe('wrong_password');
    expect((await api.post('/api/researchers/me/password').set(me.auth).send({ current: PASS, next: 'short' }).expect(400)).body.message).toMatch(/at least 8/);
    await new Promise((r) => setTimeout(r, 1100)); // the old session is from more than a second ago
    const fresh = (await api.post('/api/researchers/me/password').set(me.auth).send({ current: PASS, next: 'new-pass-123' }).expect(200)).body.data;
    expect(fresh.accessToken).toBeTruthy();
    expect((await api.get('/api/researchers/auth/refresh-token').set('token', me.refresh).expect(401)).body.code).toBe('signed_out');
    await api.get('/api/researchers/auth/refresh-token').set('token', fresh.refreshToken).expect(200);
    await api.post('/api/auth/login').send({ email: me.email, password: PASS }).expect(401);
    const login = await api.post('/api/auth/login').send({ email: me.email, password: 'new-pass-123' }).expect(200);
    me.auth = { Authorization: `Bearer ${login.body.data.accessToken}` };
    expect(lastMail(me.email, /password changed/)).toBeTruthy();
  });

  it('closing: blocked while a study is live; then signs out and removes personal details', async () => {
    const id = await plannedStudy(me.auth);
    const r = await api.post(`/api/surveys/${id}/launch/pay`).set(me.auth).send({ method: 'card', agree: true, receipt: { ...RECEIPT, email: me.email } }).expect(201);
    await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(me.auth).expect(200);
    await approve(id);
    const b = (await api.get('/api/researchers/me/close').set(me.auth).expect(200)).body.data;
    expect(b).toMatchObject({ canClose: false, reasons: ['1 live study: close it first'] });
    expect((await api.post('/api/researchers/me/close').set(me.auth).send({ confirm: 'CLOSE', password: 'new-pass-123' }).expect(409)).body.code).toBe('cannot_close');
    await api.post(`/api/surveys/${id}/live/close`).set(me.auth).expect(200);
    await SurveyModel.updateOne({ _id: id }, { $set: { closedAt: new Date(Date.now() - 3 * 3600e3) } });
    await api.get(`/api/surveys/${id}/finish`).set(me.auth).expect(200); // settles: nothing left to decide
    expect((await api.post('/api/researchers/me/close').set(me.auth).send({ confirm: 'close', password: 'new-pass-123' }).expect(400)).body.code).toBe('confirm_required');
    await api.post('/api/researchers/me/close').set(me.auth).send({ confirm: 'CLOSE', password: 'new-pass-123' }).expect(200);
    expect(lastMail('chidi@lagoslabs.ng', /account is closed/)!.text).toMatch(/refund your unused credit/);
    expect(lastMail('hello@joinstudy.io', /Credit to refund/)).toBeTruthy();
    await api.post('/api/auth/login').send({ email: 'chidi@lagoslabs.ng', password: 'new-pass-123' }).expect(401);
    const gone: any = await ResearcherModel.findById(me.id);
    expect(gone).toMatchObject({ firstName: 'Closed', email: `closed+${me.id}@joinstudy.invalid` });
    expect(await SurveyModel.countDocuments({ userId: me.id })).toBe(1); // kept for finance records
  });
});

describe('billing details', () => {
  it('saved once for the workspace; the year’s payments download as CSV', async () => {
    const owner = await researcher('yemi9@unilag.edu.ng', 'Yemi Ola');
    const d = (await api.get('/api/researchers/me/billing').set(owner.auth).expect(200)).body.data;
    expect(d).toMatchObject({ saved: false, name: 'Yemi Ola', organization: 'University of Lagos', email: 'yemi9@unilag.edu.ng', country: 'Nigeria' });
    await api.put('/api/researchers/me/billing').set(owner.auth).send({ name: 'Yemi Ola', email: 'nope' }).expect(400);
    const saved = (await api.put('/api/researchers/me/billing').set(owner.auth).send({ name: 'Yemi Ola', organization: 'University of Lagos', email: 'yemi9@unilag.edu.ng', cc: 'grants@unilag.edu.ng', reference: 'TETFUND-22', country: 'Nigeria' }).expect(200)).body.data;
    expect(saved).toMatchObject({ saved: true, cc: 'grants@unilag.edu.ng', reference: 'TETFUND-22' });
    const id = await plannedStudy(owner.auth);
    const r = await api.post(`/api/surveys/${id}/launch/pay`).set(owner.auth).send({ method: 'card', agree: true, receipt: { name: 'Yemi Ola', email: 'yemi9@unilag.edu.ng', country: 'Nigeria', reference: 'TETFUND-22' } }).expect(201);
    await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(owner.auth).expect(200);
    const csv = await api.get(`/api/researchers/me/payments.csv?year=${new Date().getFullYear()}`).set(owner.auth).expect(200);
    expect(csv.headers['content-disposition']).toMatch(/joinstudy-payments-university-of-lagos-\d{4}\.csv/);
    const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('date,number,study,what,method,card_last4,paid_by,amount,credit_used,refunded_to_card,currency,reference,status');
    expect(lines[1]).toMatch(/,How Lagos commuters get to work,launch,card,4242,Yemi Ola,11800\.00,0\.00,0\.00,NGN,TETFUND-22,paid$/);
  });
});
