import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../app';
import { connectDB } from '../../config/database';
import { outbox } from '../../utils/mailer';
import { signAccessToken } from '../../utils/jwt';
import { ParticipantModel } from '../../modules/user/models/participant.model';
import { SurveyActionModel, SurveyModel } from '../../modules/survey/survey.model';
import { approve } from '../../modules/billing/launch.service';
import { resolve } from '../../modules/after/after.service';
import { TransactionModel } from '../../modules/wallet/transaction.model';

/** Participant Stage 5: my studies, the reason for a decision, a question about it, and joinStudy looking. */
const api = request(app);
const lastMail = (to: string, re: RegExp) => [...outbox].reverse().find((m) => m.to.includes(to) && re.test(m.subject));
type Auth = { Authorization: string; id: string };
let n = 0;
const ME = '/api/participants/me';
const H = (p: Auth) => ({ Authorization: p.Authorization });

async function participant(): Promise<Auth> {
  const p = await ParticipantModel.create({ email: `p5-${++n}@example.com`, firstName: 'Amaka', lastName: 'Eze', password: 'x-not-used-1', isVerified: true, country: 'Nigeria', 'verification.status': 'verified' });
  const auth = { Authorization: `Bearer ${signAccessToken({ id: String(p._id), userType: 'participant' } as any)}`, id: String(p._id) };
  const h = H(auth);
  await api.put(`${ME}/profile/where`).set(h).send({ region: 'Lagos', birthMonth: 5, birthYear: 1994, gender: 'female' }).expect(200);
  await api.put(`${ME}/profile/languages`).set(h).send({ firstLanguage: 'Igbo', languages: ['English'] }).expect(200);
  await api.put(`${ME}/profile/work`).set(h).send({ education: 'bachelor', student: 'no', work: 'self-employed', devices: ['android'] }).expect(200);
  return auth;
}

let ada: { Authorization: string };
const RESEARCHER = 'jane.p5@umich.edu';
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
  await connectDB(process.env.MONGO_URI!.replace(/\/[^/]*$/, '/joinstudy_p5_test'));
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  ada = await researcher();
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});


async function finished(p: Auth, id: string, minutesAgo = 12) {
  await start(p, id).expect(200);
  await ago(p, id, minutesAgo);
  await api.post(`/api/surveys/done/${await codeOf(id)}`).set(H(p)).expect(200);
  return String((await SurveyActionModel.findOne({ surveyId: id, participantId: p.id }))!._id);
}
const reject = (id: string, ids: string[], note = 'Two of the three check questions had the wrong answer.') =>
  api.post(`/api/surveys/${id}/review`).set(ada).send({ ids, decision: 'reject', reason: 'attention', note }).expect(200);
const earning = (actionId: string) => TransactionModel.findOne({ ledgerKey: `${actionId}:earning` });
const WHY = { why: 'did-checks', message: 'I answered every check question; the second was about market days.' };

describe('5.1 my studies', () => {
  it('lists every study they started, by status, with money and dates', async () => {
    const [s1, s2, s3, s4] = [await liveStudy('Waiting one', { perPerson: 2, places: 10 }), await liveStudy('Paid one', { perPerson: 1.5, places: 10 }), await liveStudy('Rejected one', { perPerson: 3, places: 10 }), await liveStudy('Left one', { perPerson: 2, places: 10 })];
    const p = await participant();
    await finished(p, s1);
    const paid = await finished(p, s2);
    await api.post(`/api/surveys/${s2}/review`).set(ada).send({ ids: [paid], decision: 'approve' }).expect(200);
    const rej = await finished(p, s3);
    await reject(s3, [rej]);
    await start(p, s4).expect(200);
    await api.post(`${ME}/studies/${s4}/leave`).set(H(p)).send({}).expect(200);
    const other = await liveStudy('In progress one', { perPerson: 2, places: 10 });
    await start(p, other).expect(200);

    const r = await api.get(`${ME}/my-studies`).set(H(p)).expect(200);
    const by = Object.fromEntries(r.body.data.rows.map((x: any) => [x.title, x]));
    expect(by['Waiting one']).toMatchObject({ bucket: 'waiting', amount: 2 });
    expect(new Date(by['Waiting one'].autoApproveAt).getTime()).toBeGreaterThan(Date.now() + 6 * 864e5);
    expect(by['Paid one']).toMatchObject({ bucket: 'paid', amount: 1.5 });
    expect(by['Rejected one']).toMatchObject({ bucket: 'not-approved', appeal: null });
    expect(by['Rejected one'].askUntil).toBeTruthy();
    expect(by['Left one']).toMatchObject({ bucket: 'ended', status: 'left' });
    expect(by['In progress one'].bucket).toBe('in-progress');
    expect(by['In progress one'].heldUntil).toBeTruthy();
    expect(r.body.data.counts).toMatchObject({ all: 5, waiting: 1, paid: 1, 'not-approved': 1, ended: 1, 'in-progress': 1 });
  });
});

describe('5.2–5.4 a decision, and asking about it', () => {
  it('shows the reason and note; the researcher approves it after all, and it’s paid', async () => {
    const id = await liveStudy('Market days in Kano', { perPerson: 3, places: 10 });
    const p = await participant();
    const aid = await finished(p, id);
    await reject(id, [aid]);
    expect((await earning(aid))!.status).toBe('cancelled');
    expect(lastMail((await ParticipantModel.findById(p.id))!.email, /^Not approved/)!.text).toMatch(/my-studies/);

    const d = await api.get(`${ME}/my-studies/${id}`).set(H(p)).expect(200);
    expect(d.body.data).toMatchObject({ status: 'rejected', reason: { key: 'attention', text: 'the attention checks in the study were missed' }, note: 'Two of the three check questions had the wrong answer.', canAsk: true, canEscalate: false, appeal: null });

    await api.post(`${ME}/my-studies/${id}/ask`).set(H(p)).send({ why: 'did-checks', message: 'too short' }).expect(400);
    const asked = await api.post(`${ME}/my-studies/${id}/ask`).set(H(p)).send(WHY).expect(200);
    expect(asked.body.data).toMatchObject({ canAsk: false, canEscalate: false, appeal: { status: 'open', whyLabel: 'I did the attention checks' } });
    await api.post(`${ME}/my-studies/${id}/ask`).set(H(p)).send(WHY).expect(409); // one per study
    await api.post(`${ME}/my-studies/${id}/escalate`).set(H(p)).expect(409); // the researcher has 7 days first
    expect(lastMail(RESEARCHER, /asked about your decision/)!.text).toMatch(/second was about market days/);

    const rv = await api.get(`/api/surveys/${id}/review`).set(ada).expect(200);
    expect(rv.body.data.counts.questions).toBe(1);
    expect(rv.body.data.items.find((i: any) => i.surveyActionId === aid).question).toMatchObject({ status: 'open', why: 'did-checks' });
    const todo = await api.get('/api/researchers/me/to-review').set(ada).expect(200);
    expect(todo.body.data.find((x: any) => x.surveyId === id)).toMatchObject({ questions: 1 });

    await api.post(`/api/surveys/${id}/review/${aid}/answer`).set(ada).send({ decision: 'approve', reply: 'You’re right, the answer key was wrong.' }).expect(200);
    expect((await SurveyActionModel.findById(aid))!.status).toBe('approved');
    expect((await earning(aid))!.status).toBe('available');
    expect(await TransactionModel.exists({ ledgerKey: `${aid}:charge` })).toBeTruthy();
    const after = await api.get(`${ME}/my-studies/${id}`).set(H(p)).expect(200);
    expect(after.body.data).toMatchObject({ status: 'approved', appeal: { status: 'approved', answer: 'You’re right, the answer key was wrong.' }, canAsk: false });
    const rows = (await api.get(`${ME}/my-studies`).set(H(p))).body.data.rows;
    expect(rows.find((r: any) => r.surveyId === id)).toMatchObject({ bucket: 'paid', changed: true });
    await api.post(`/api/surveys/${id}/review/${aid}/answer`).set(ada).send({ decision: 'keep', reply: 'Changed my mind again.' }).expect(409);
  });

  it('kept with a reply → the participant can ask joinStudy; joinStudy can overturn it', async () => {
    const id = await liveStudy('Kept decision', { perPerson: 2, places: 10 });
    const p = await participant();
    const aid = await finished(p, id);
    await reject(id, [aid]);
    await api.post(`${ME}/my-studies/${id}/ask`).set(H(p)).send(WHY).expect(200);
    await api.post(`/api/surveys/${id}/review/${aid}/answer`).set(ada).send({ decision: 'keep' }).expect(400); // needs a reply
    await api.post(`/api/surveys/${id}/review/${aid}/answer`).set(ada).send({ decision: 'keep', reply: 'Two of three checks were wrong; that is the rule we set.' }).expect(200);
    const d = await api.get(`${ME}/my-studies/${id}`).set(H(p)).expect(200);
    expect(d.body.data).toMatchObject({ appeal: { status: 'kept' }, canEscalate: true });
    await api.post(`${ME}/my-studies/${id}/escalate`).set(H(p)).expect(200);
    expect(lastMail('hello@joinstudy.io', /^Decision to review/)!.text).toMatch(/review-appeal -- overturn/);
    await resolve(aid, 'overturn', 'The checks were answered as the study asked.');
    expect((await SurveyActionModel.findById(aid))!.get('appeal.status')).toBe('overturned');
    expect((await earning(aid))!.status).toBe('available');
    expect(lastMail(RESEARCHER, /joinStudy approved/)).toBeTruthy();
  });

  it('no answer in 7 days → ask joinStudy; uphold is final; too late after 14 days', async () => {
    const id = await liveStudy('Quiet researcher', { perPerson: 2, places: 10 });
    const [p, late] = [await participant(), await participant()];
    const aid = await finished(p, id);
    const lid = await finished(late, id);
    await reject(id, [aid, lid]);
    await api.post(`${ME}/my-studies/${id}/ask`).set(H(p)).send(WHY).expect(200);
    await SurveyActionModel.updateOne({ _id: aid }, { $set: { 'appeal.askedAt': new Date(Date.now() - 8 * 864e5) } });
    expect((await api.get(`${ME}/my-studies/${id}`).set(H(p))).body.data.canEscalate).toBe(true);
    await api.post(`${ME}/my-studies/${id}/escalate`).set(H(p)).expect(200);
    await resolve(aid, 'uphold', 'The answers missed two checks.');
    const d = await api.get(`${ME}/my-studies/${id}`).set(H(p)).expect(200);
    expect(d.body.data).toMatchObject({ status: 'rejected', appeal: { status: 'upheld', resolution: 'The answers missed two checks.' }, canEscalate: false });

    await SurveyActionModel.updateOne({ _id: lid }, { $set: { reviewedAt: new Date(Date.now() - 15 * 864e5) } });
    const tooLate = await api.post(`${ME}/my-studies/${id}/ask`).set(H(late)).send(WHY).expect(409);
    expect(tooLate.body.message).toMatch(/14 days/);
  });

  it('only their own, and only rejected work can be asked about', async () => {
    const id = await liveStudy('Not mine', { perPerson: 2, places: 10 });
    const [p, q] = [await participant(), await participant()];
    await finished(p, id);
    await api.get(`${ME}/my-studies/${id}`).set(H(q)).expect(404);
    await api.post(`${ME}/my-studies/${id}/ask`).set(H(p)).send(WHY).expect(409);
  });
});
