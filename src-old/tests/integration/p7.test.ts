import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../app';
import { connectDB } from '../../config/database';
import { outbox } from '../../utils/mailer';
import { hashPassword } from '../../utils/hash';
import { signAccessToken, signRefreshToken } from '../../utils/jwt';
import { ParticipantModel } from '../../modules/user/models/participant.model';
import { SurveyActionModel, SurveyModel } from '../../modules/survey/survey.model';
import { approve } from '../../modules/billing/launch.service';
import { TransactionModel } from '../../modules/wallet/transaction.model';
import { MessageModel } from '../../modules/run/message.model';
import { lastTestCode } from '../../modules/verification/providers';
import { releaseStudy } from '../../modules/account/help.service';
import { ClosedIdentityModel, SupportCaseModel } from '../../modules/account/models';
import { wantsMessageEmails } from '../../modules/account/settings.service';

/** Participant Stage 7: settings, your data (download, close), help, and reporting a study. */
const api = request(app);
const lastMail = (to: string, re: RegExp) => [...outbox].reverse().find((m) => m.to.includes(to) && re.test(m.subject));
type Auth = { Authorization: string; id: string; email: string };
let n = 0;
const ME = '/api/participants/me';
const H = (p: { Authorization: string }) => ({ Authorization: p.Authorization });
const PASSWORD = 'amaka-pass-1';
const bearer = (id: string) => `Bearer ${signAccessToken({ id, userType: 'participant' })}`;

async function participant(extra: Record<string, unknown> = {}): Promise<Auth> {
  const email = `p7-${++n}@example.com`;
  const p = await ParticipantModel.create({ email, firstName: 'Amaka', lastName: 'Eze', password: await hashPassword(PASSWORD), isVerified: true, country: 'Nigeria', receivesUpdates: true, ...extra });
  return { Authorization: bearer(String(p._id)), id: String(p._id), email };
}
async function withPhone(p: Auth, phone: string) {
  await api.post(`${ME}/verification/consent`).set(H(p)).expect(200);
  await api.post(`${ME}/verification/phone/send`).set(H(p)).send({ phone, channel: 'whatsapp' }).expect(200);
  await api.post(`${ME}/verification/phone/verify`).set(H(p)).send({ code: lastTestCode(`+234${phone.slice(1)}`) }).expect(200);
}

let ada: { Authorization: string };
const RESEARCHER = 'jane.p7@umich.edu';
async function researcher() {
  await api.post('/api/researchers/auth/register').send({ fullName: 'Jane Okafor', email: RESEARCHER, password: 'research-pass-1' }).expect(201);
  const url = new URL(lastMail(RESEARCHER, /verify/i)!.text.match(/https?:\/\/\S+/)![0]);
  const res = await api.get('/api/researchers/auth/verify-email').query({ email: RESEARCHER, token: url.searchParams.get('token') }).expect(200);
  const auth = { Authorization: `Bearer ${res.body.data.accessToken}` };
  await api.put('/api/researchers/me/profile').set(auth).send({ organizationType: 'university', organizationName: 'University of Michigan', country: 'United States' }).expect(200);
  return auth;
}
let fund = 0;
async function liveStudy(title: string) {
  const s = await api.post('/api/surveys/start').set(ada).send({ method: 'survey' }).expect(201);
  const id = s.body.data.surveyId;
  const plan: Record<string, object> = {
    basics: { title, description: 'About your trip to work.', consent: { mode: 'own', text: '' } },
    audience: { countries: ['Nigeria'], minAge: 18, maxAge: 100 },
    setup: { url: 'https://forms.example/lagos', minutes: 15, devices: ['phone'] },
    pay: { perPerson: 3, places: 20 },
  };
  for (const step of ['basics', 'audience', 'setup', 'pay']) await api.put(`/api/surveys/${id}/plan/${step}`).set(ada).send({ data: plan[step], final: true }).expect(200);
  const r = await api.post(`/api/surveys/${id}/launch/pay`).set(ada).send({ method: 'card', agree: true, receipt: { name: 'Jane Okafor', email: `fund${++fund}@umich.edu`, country: 'United States' } }).expect(201);
  await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(ada).expect(200);
  await approve(id);
  return id as string;
}

beforeAll(async () => {
  await connectDB(process.env.MONGO_URI!.replace(/\/[^/]*$/, '/joinstudy_p7_test'));
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  ada = await researcher();
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('7.1 settings', () => {
  it('shows the account, and locks the name once verified', async () => {
    const p = await participant();
    const r = await api.get(`${ME}/settings`).set(H(p)).expect(200);
    expect(r.body.data).toMatchObject({ email: p.email, name: 'Amaka Eze', nameLocked: false, hasPassword: true, phone: null, emailPrefs: { studies: true, messages: true, news: false } });
    await ParticipantModel.updateOne({ _id: p.id }, { $set: { 'verification.status': 'verified' } });
    expect((await api.get(`${ME}/settings`).set(H(p)).expect(200)).body.data.nameLocked).toBe(true);
  });

  it('changes the email only after the link, and tells the old address', async () => {
    const p = await participant();
    const other = await participant();
    expect((await api.post(`${ME}/settings/email`).set(H(p)).send({ email: 'new@example.com', password: 'wrong-pass-1' }).expect(400)).body.code).toBe('wrong_password');
    expect((await api.post(`${ME}/settings/email`).set(H(p)).send({ email: other.email, password: PASSWORD }).expect(409)).body.code).toBe('email_taken');
    const r = await api.post(`${ME}/settings/email`).set(H(p)).send({ email: 'Amaka.New@Example.com', password: PASSWORD }).expect(200);
    expect(r.body.data).toMatchObject({ email: p.email, pendingEmail: 'amaka.new@example.com' });
    expect(lastMail(p.email, /is changing/)).toBeTruthy();
    const link = lastMail('amaka.new@example.com', /Confirm your new email/)!.text.match(/https?:\/\/\S+/)![0];
    expect(link).toContain('/participate/confirm-email?token=');
    const token = new URL(link).searchParams.get('token');
    await api.post('/api/participants/settings/confirm-email').send({ token }).expect(200);
    expect((await api.get(`${ME}/settings`).set(H(p)).expect(200)).body.data).toMatchObject({ email: 'amaka.new@example.com', pendingEmail: null });
    expect(lastMail(p.email, /email changed/)).toBeTruthy();
    expect((await api.post('/api/participants/settings/confirm-email').send({ token }).expect(410)).body.code).toBe('link_expired');
    // Signing in uses the new email.
    await api.post('/api/auth/login').send({ email: 'amaka.new@example.com', password: PASSWORD }).expect(200);
  });

  it('a password change signs out other devices; this device gets new tokens', async () => {
    const p = await participant();
    const oldRefresh = signRefreshToken({ id: p.id, userType: 'participant' });
    expect((await api.post(`${ME}/settings/password`).set(H(p)).send({ current: 'nope-nope-1', next: 'brand-new-pass-1' }).expect(400)).body.code).toBe('wrong_password');
    const r = await api.post(`${ME}/settings/password`).set(H(p)).send({ current: PASSWORD, next: 'brand-new-pass-1' }).expect(200);
    await api.get(`${ME}/settings`).set(H(p)).expect(401); // the old token
    await api.get(`${ME}/settings`).set({ Authorization: `Bearer ${r.body.data.accessToken}` }).expect(200);
    await api.get('/api/participants/auth/refresh-token').set('token', oldRefresh).expect(401);
    await api.get('/api/participants/auth/refresh-token').set('token', r.body.data.refreshToken).expect(200);
    expect(lastMail(p.email, /password changed/)).toBeTruthy();
    await api.post('/api/auth/login').send({ email: p.email, password: 'brand-new-pass-1' }).expect(200);
  });

  it('signs out everywhere else, and this device stays signed in with the tokens it has', async () => {
    const p = await participant();
    const here = { Authorization: `Bearer ${signAccessToken({ id: p.id, userType: 'participant', sid: 'phone-1' })}` };
    const there = { Authorization: `Bearer ${signAccessToken({ id: p.id, userType: 'participant', sid: 'laptop-1', at: Date.now() })}` };
    const thereRefresh = signRefreshToken({ id: p.id, userType: 'participant', sid: 'laptop-1' });
    const r = await api.post(`${ME}/settings/sign-out-others`).set(here).expect(200);
    await api.get(`${ME}/home`).set(here).expect(200);
    await api.get(`${ME}/home`).set({ Authorization: `Bearer ${r.body.data.accessToken}` }).expect(200);
    await api.get(`${ME}/home`).set(there).expect(401);
    await api.get(`${ME}/home`).set(H(p)).expect(401); // an older token without a sign-in id
    await api.get('/api/participants/auth/refresh-token').set('token', thereRefresh).expect(401);
    // Signing in again starts a new, valid sign-in.
    const fresh = await api.post('/api/auth/login').send({ email: p.email, password: PASSWORD }).expect(200);
    await api.get(`${ME}/home`).set({ Authorization: `Bearer ${fresh.body.data.accessToken}` }).expect(200);
  });

  it('changes the WhatsApp number with a code; one number per account still applies', async () => {
    const p = await participant();
    const other = await participant();
    expect((await api.post(`${ME}/settings/phone/send`).set(H(p)).send({ phone: '08031110001' }).expect(409)).body.code).toBe('no_phone');
    await withPhone(p, '08031110001');
    await withPhone(other, '08031110002');
    expect((await api.post(`${ME}/settings/phone/send`).set(H(p)).send({ phone: '08031110001' }).expect(400)).body.code).toBe('same_phone');
    expect((await api.post(`${ME}/settings/phone/send`).set(H(p)).send({ phone: '08031110002' }).expect(409)).body.code).toBe('phone_taken');
    await ParticipantModel.updateOne({ _id: p.id }, { $unset: { 'verification.sends': 1 } }); // skip the 30-second wait between codes
    await api.post(`${ME}/settings/phone/send`).set(H(p)).send({ phone: '08031110003', channel: 'whatsapp' }).expect(200);
    await api.post(`${ME}/settings/phone/verify`).set(H(p)).send({ code: lastTestCode('+2348031110003') === '000000' ? '111111' : '000000' }).expect(400);
    const r = await api.post(`${ME}/settings/phone/verify`).set(H(p)).send({ code: lastTestCode('+2348031110003') }).expect(200);
    expect(r.body.data.phone).toEqual({ last2: '03', channel: 'whatsapp' });
    expect(lastMail(p.email, /WhatsApp number changed/)).toBeTruthy();
  });

  it('email choices: studies, messages, news; message emails respect them', async () => {
    const p = await participant();
    const r = await api.put(`${ME}/settings/email-prefs`).set(H(p)).send({ studies: false, messages: false, news: true }).expect(200);
    expect(r.body.data.emailPrefs).toEqual({ studies: false, messages: false, news: true });
    expect((await ParticipantModel.findById(p.id))!.get('receivesUpdates')).toBe(false);
    expect(await wantsMessageEmails(p.id)).toBeNull();
    await api.put(`${ME}/settings/email-prefs`).set(H(p)).send({ messages: true }).expect(200);
    expect(await wantsMessageEmails(p.id)).toBe(p.email);
  });
});

describe('7.2 your data', () => {
  it('downloads everything as JSON, without secrets', async () => {
    const p = await participant();
    await withPhone(p, '08032220001');
    await api.put(`${ME}/profile/where`).set(H(p)).send({ region: 'Lagos', birthMonth: 5, birthYear: 1994, gender: 'female' }).expect(200);
    await TransactionModel.create({ ownerId: p.id, ownerType: 'participant', kind: 'earning', status: 'available', amount: 4, currency: 'USD', ledgerKey: `${p.id}:x:earning` });
    const r = await api.get(`${ME}/data.json`).set(H(p)).expect(200);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="joinstudy-my-data-/);
    const d = JSON.parse(r.text);
    expect(d.account).toMatchObject({ firstName: 'Amaka', email: p.email, country: 'Nigeria' });
    expect(d.profile).toMatchObject({ region: 'Lagos', gender: 'female' });
    expect(d.verification).toMatchObject({ phoneEndsWith: '01' });
    expect(d.money).toEqual([expect.objectContaining({ kind: 'earning', amount: 4 })]);
    expect(r.text).not.toMatch(/password|phoneHash|accountHash|\$2b\$/);
  });

  it('closing: blocked by a study in progress; then gives up money only when ticked; then deletes and keeps codes', async () => {
    const study = await liveStudy('Trips to work in Lagos');
    const s: any = await SurveyModel.findById(study);
    const p = await participant();
    await withPhone(p, '08033330001');
    await api.put(`${ME}/payout-method`).set(H(p)).send({ method: 'bank', institution: 'GTBank', account: '0123456781' }).expect(200);
    const running = await SurveyActionModel.create({ surveyId: study, researcherId: s.userId, participantId: p.id, status: 'in-progress', heldUntil: new Date(Date.now() + 3600e3) });
    const c1 = await api.get(`${ME}/close`).set(H(p)).expect(200);
    expect(c1.body.data).toMatchObject({ canClose: false, ready: 0, waiting: 0 });
    expect((await api.post(`${ME}/close`).set(H(p)).send({ password: PASSWORD }).expect(409)).body.code).toBe('cannot_close');

    // Finished, waiting for approval ($3) and $2 ready.
    await SurveyActionModel.updateOne({ _id: running._id }, { $set: { status: 'submitted', submittedAt: new Date(), amount: 3, currency: 'USD' }, $unset: { heldUntil: 1 } });
    await TransactionModel.create({ ownerId: p.id, ownerType: 'participant', kind: 'earning', status: 'pending', amount: 3, currency: 'USD', surveyId: study, surveyActionId: running._id, ledgerKey: `${running._id}:earning` });
    await TransactionModel.create({ ownerId: p.id, ownerType: 'participant', kind: 'earning', status: 'available', amount: 2, currency: 'USD', ledgerKey: `${p.id}:old:earning` });
    await MessageModel.create({ surveyId: study, researcherId: s.userId, participantId: p.id, from: 'researcher', body: 'Thanks for taking part.' });
    expect((await api.get(`${ME}/close`).set(H(p)).expect(200)).body.data).toMatchObject({ canClose: true, ready: 2, waiting: 3, canCashOut: false });
    expect((await api.post(`${ME}/close`).set(H(p)).send({ password: 'wrong-pass-1', giveUp: true }).expect(400)).body.code).toBe('wrong_password');
    const need = await api.post(`${ME}/close`).set(H(p)).send({ password: PASSWORD }).expect(409);
    expect(need.body.code).toBe('give_up_needed');
    expect(need.body.message || need.body.error).toMatch(/5\.00/);

    await api.post(`${ME}/close`).set(H(p)).send({ password: PASSWORD, giveUp: true }).expect(200);
    await api.get(`${ME}/settings`).set(H(p)).expect(401);
    await api.post('/api/auth/login').send({ email: p.email, password: PASSWORD }).expect(401);
    const gone: any = await ParticipantModel.findById(p.id).select('+password +verification.phoneHash +payout.accountHash').lean();
    expect(gone).toMatchObject({ firstName: 'Closed', lastName: 'account', email: `closed+${p.id}@joinstudy.invalid` });
    expect(gone.closedAt).toBeTruthy();
    for (const k of ['password', 'profile', 'payout', 'country']) expect(gone[k]).toBeUndefined();
    expect(gone.verification?.phoneHash).toBeUndefined();
    expect(await MessageModel.countDocuments({ participantId: p.id })).toBe(0);
    // The work waiting for approval is given up; the researcher isn't charged.
    expect(await SurveyActionModel.findById(running._id).lean()).toMatchObject({ status: 'left', leftReason: 'account-closed' });
    expect(await TransactionModel.findOne({ surveyActionId: running._id, kind: 'earning' }).lean()).toMatchObject({ status: 'cancelled' });
    expect(await TransactionModel.findOne({ ownerId: p.id, kind: 'forfeit' }).lean()).toMatchObject({ amount: 2 });
    expect(await TransactionModel.countDocuments({ ownerId: p.id, kind: 'earning' })).toBe(2); // payment records kept
    expect(lastMail(p.email, /account is closed/)).toBeTruthy();
    expect(await ClosedIdentityModel.countDocuments()).toBe(2);

    // The same phone and payout account can't come back as a "new person" for 12 months.
    const again = await participant();
    await api.post(`${ME}/verification/consent`).set(H(again)).expect(200);
    expect((await api.post(`${ME}/verification/phone/send`).set(H(again)).send({ phone: '08033330001' }).expect(409)).body.code).toBe('phone_closed');
    expect((await api.put(`${ME}/payout-method`).set(H(again)).send({ method: 'bank', institution: 'GTBank', account: '0123456781' }).expect(409)).body.code).toBe('account_closed');
  });

  it('closes straight away when there is no money', async () => {
    const p = await participant();
    await api.post(`${ME}/close`).set(H(p)).send({ password: PASSWORD }).expect(200);
    await api.get(`${ME}/home`).set(H(p)).expect(401);
  });
});

describe('7.3 help', () => {
  it('contact joinStudy: a reference, the support inbox, and a copy to them', async () => {
    const p = await participant();
    expect((await api.post(`${ME}/help/contact`).set(H(p)).send({ topic: 'money', message: 'too short' }).expect(400)).body).toBeTruthy();
    const r = await api.post(`${ME}/help/contact`).set(H(p)).send({ topic: 'money', message: 'My cash-out to GTBank has not arrived after 2 days.' }).expect(200);
    expect(r.body.data.reference).toMatch(/^JS-HP-\d{6}$/);
    const inbox = [...outbox].reverse().find((m) => m.subject.startsWith(r.body.data.reference));
    expect(inbox!.text).toContain(p.email);
    expect(lastMail(p.email, new RegExp(r.body.data.reference))).toBeTruthy();
  });
});

describe('7.4 report a study', () => {
  it('every report reaches joinStudy; 3 people reporting bank details pause the study until joinStudy lifts it', async () => {
    const study = await liveStudy('Phone repair shops');
    const [a, b, c, d] = [await participant(), await participant(), await participant(), await participant()];
    const form = await api.get(`${ME}/studies/${study}/report`).set(H(a)).expect(200);
    expect(form.body.data).toMatchObject({ title: 'Phone repair shops', already: null });
    expect(form.body.data.reasons).toHaveLength(6);
    expect((await api.post(`${ME}/studies/${study}/report`).set(H(a)).send({ reason: 'other' }).expect(400)).body.code).toBe('message_needed');

    const r1 = await api.post(`${ME}/studies/${study}/report`).set(H(a)).send({ reason: 'asks-details', message: 'Page 3 asked for my bank account number and BVN.' }).expect(200);
    expect(r1.body.data).toMatchObject({ paused: false, safety: true });
    expect(r1.body.data.reference).toMatch(/^JS-RP-\d{6}$/);
    expect([...outbox].reverse().find((m) => m.subject.includes(r1.body.data.reference))!.text).toContain('bank account number');
    // The same person reporting again doesn't count twice.
    await api.post(`${ME}/studies/${study}/report`).set(H(a)).send({ reason: 'asks-money' }).expect(200);
    await api.post(`${ME}/studies/${study}/report`).set(H(b)).send({ reason: 'broken-link' }).expect(200); // not a serious reason
    expect((await SurveyModel.findById(study))!.get('paused')).toBe(false);
    await api.post(`${ME}/studies/${study}/report`).set(H(c)).send({ reason: 'asks-money' }).expect(200);
    expect((await SurveyModel.findById(study))!.get('paused')).toBe(false);
    const r4 = await api.post(`${ME}/studies/${study}/report`).set(H(d)).send({ reason: 'harmful' }).expect(200);
    expect(r4.body.data.paused).toBe(true);
    expect(await SupportCaseModel.countDocuments({ surveyId: study })).toBe(4);
    const s: any = await SurveyModel.findById(study);
    expect(s.paused).toBe(true);
    expect(s.reportHold.reports).toBe(3);
    expect(lastMail(RESEARCHER, /is paused while joinStudy checks it/)).toBeTruthy();
    expect(lastMail(RESEARCHER, /is paused/)!.text).not.toMatch(/p7-\d+@example\.com|Amaka/);
    // The researcher can't lift it themselves; it's gone from studies that fit.
    expect((await api.post(`/api/surveys/${study}/live/resume`).set(ada).expect(409)).body.code).toBe('report_hold');
    const studies = await api.get(`${ME}/studies`).set(H(await participant())).expect(200);
    expect(studies.body.data.studies.map((x: any) => x.surveyId || x.id)).not.toContain(study);

    await releaseStudy(study, 'The researcher removed the question.');
    expect((await SurveyModel.findById(study))!.get('paused')).toBe(false);
    expect(await SupportCaseModel.countDocuments({ surveyId: study, status: 'open' })).toBe(0);
    expect(lastMail(RESEARCHER, /is live again/)).toBeTruthy();
  });
});
