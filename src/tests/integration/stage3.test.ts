import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import app from '../../app';
import { connectDB } from '../../config/database';
import { outbox } from '../../utils/mailer';
import { SurveyActionModel } from '../../modules/survey/survey.model';
import { LeadModel } from '../../modules/leads/lead.model';
import { ProjectModel } from '../../modules/project/project.model';
import { ResearcherModel } from '../../modules/user/models/researcher.model';

/** Stage 3: the researcher home (3.1), starting a study from it, the cost estimate's pricing (3.2) and the founding-lab card. */
const api = request(app);
const PASS = 'research-pass-1';
const lastMail = (to: string, re: RegExp) => [...outbox].reverse().find((m) => m.to === to && re.test(m.subject));

async function researcher(email: string, fullName = 'Ada Obi') {
  await api.post('/api/researchers/auth/register').send({ fullName, email, password: PASS }).expect(201);
  const url = new URL(lastMail(email, /verify/i)!.text.match(/https?:\/\/\S+/)![0]);
  const res = await api.get('/api/researchers/auth/verify-email').query({ email, token: url.searchParams.get('token') }).expect(200);
  return { Authorization: `Bearer ${res.body.data.accessToken}` };
}
const home = async (auth: { Authorization: string }) => (await api.get('/api/researchers/me/home').set(auth).expect(200)).body.data;

beforeAll(async () => {
  await connectDB(process.env.MONGO_URI!.replace(/\/[^/]*$/, '/joinstudy_stage3_test'));
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('3.1 home, first visit', () => {
  it('starts empty, with no made-up numbers', async () => {
    const auth = await researcher('new@ufl.edu');
    const h = await home(auth);
    expect(h).toMatchObject({
      firstName: 'Ada',
      counts: { total: 0, draft: 0, live: 0, closed: 0 },
      studies: [],
      needsYou: [],
      money: { paid: 0 },
      founding: 'none',
      account: { setupComplete: false, feeRate: 0.2 },
    });
    expect(h.money).toMatchObject({ paid: 0, held: 0, credit: 0 });
  });

  it('pricing tells the estimate the fees and the hourly pay settings (none set for naira)', async () => {
    const res = await api.get('/api/pricing').expect(200);
    expect(res.body.data).toMatchObject({ platformFeeRate: 0.2, academicFeeRate: 0.18, minHourlyPay: null, recommendedHourlyPay: null });
  });
});

describe('starting a study from the home page', () => {
  let auth: { Authorization: string };
  beforeAll(async () => { auth = await researcher('kemi@gmail.com', 'Kemi Bello'); });

  it('needs a method', async () => {
    const res = await api.post('/api/surveys/start').set(auth).send({ method: 'podcast' }).expect(400);
    expect(res.body.message).toMatch(/what you want to run/);
  });

  it('makes a draft without asking for a project, prefilled from the estimate', async () => {
    const res = await api.post('/api/surveys/start').set(auth).send({ method: 'interview', estimate: { participants: 12, minutes: 45, ratePerHour: 20 } }).expect(201);
    expect(res.body.data).toMatchObject({ method: 'interview', surveyType: 'external', status: 'draft', surveyName: 'Untitled interview study', numberOfParticipants: 12, surveyDuration: 45, surveyAmount: 15 });
    const again = await api.post('/api/surveys/start').set(auth).send({ method: 'ai-evaluation', surveyName: 'Yoruba ratings' }).expect(201);
    expect(again.body.data).toMatchObject({ surveyType: 'aiTaskBuilder', surveyName: 'Yoruba ratings' });
    expect(again.body.data.projectId).toBe(res.body.data.projectId);
    expect(await ProjectModel.countDocuments({ title: 'My studies' })).toBe(1);
  });

  it('only researchers can start studies', async () => {
    await api.post('/api/surveys/start').send({ method: 'survey' }).expect(401);
  });
});

describe('3.1 home, returning researcher', () => {
  let auth: { Authorization: string };
  let liveId: string;

  beforeAll(async () => {
    auth = await researcher('tolu@unilag.edu.ng', 'Tolu Ade');
    await api.put('/api/researchers/me/profile').set(auth).send({ organizationType: 'university', organizationName: 'University of Lagos', country: 'Nigeria' }).expect(200);
    // A study inside a project the researcher made themselves still shows on the home page.
    const p = await api.post('/api/projects/create-project').set(auth).send({ title: 'Commuting' }).expect(201);
    const s = await api.post('/api/surveys/create-draft-survey').set(auth).send({ projectId: p.body.data._id, surveyName: 'Lagos commuters survey' }).expect(201);
    liveId = s.body.data.surveyId;
    await api.put(`/api/surveys/update-draft-survey/${liveId}`).set(auth).send({
      surveyType: 'external', surveyName: 'Lagos commuters survey', surveyDescription: 'How people get to work', surveyURL: 'https://forms.example/lagos',
      minimumAge: 18, maximumAge: 65, numberOfParticipants: 100, surveyDuration: 15, surveyAmount: 3,
    }).expect(200);
    await api.post(`/api/surveys/publish-draft-survey/${liveId}`).set(auth).expect(200);
    await api.post('/api/surveys/start').set(auth).send({ method: 'focus-group' }).expect(201);
    const researcherId = (await ResearcherModel.findOne({ email: 'tolu@unilag.edu.ng' }))!._id;
    for (let i = 0; i < 3; i++) {
      await SurveyActionModel.create({ surveyId: liveId, researcherId, participantId: new Types.ObjectId(), status: 'submitted', submittedAt: new Date(), amount: 3, currency: 'NGN' });
    }
    const first = await SurveyActionModel.findOne({ surveyId: liveId });
    await api.put(`/api/surveys/approve-survey-action/${first!._id}`).set(auth).expect(200);
  });

  it('lists studies from every project, with real progress and spend', async () => {
    const h = await home(auth);
    expect(h.counts).toEqual({ total: 2, draft: 1, live: 1, closed: 0 });
    const live = h.studies.find((s: any) => s.surveyId === liveId);
    // Verified academic (unilag.edu.ng): 3.00 reward + 18% fee for the one approved submission.
    expect(live).toMatchObject({ name: 'Lagos commuters survey', method: 'survey', status: 'live', places: 100, approved: 1, toReview: 2, spent: 3.54, missing: [] });
    expect(h.money.paid).toBe(3.54);
    expect(h.account).toMatchObject({ setupComplete: true, verification: 'verified', feeRate: 0.18 });
  });

  it('puts work to review first, then drafts and what they still need', async () => {
    const h = await home(auth);
    expect(h.needsYou[0]).toMatchObject({ kind: 'review', surveyId: liveId, count: 2 });
    expect(h.needsYou[1]).toMatchObject({ kind: 'draft', name: 'Untitled focus group' });
    expect(h.needsYou[1].missing).toEqual(expect.arrayContaining(['Add your meeting link.', 'Set what each person earns.']));
  });

  it("doesn't show other researchers' studies", async () => {
    const other = await researcher('someone@gmail.com', 'Some One');
    expect((await home(other)).studies).toEqual([]);
  });
});

describe('founding-lab card', () => {
  it('"Not now" hides it; applying sends one request with the details we have', async () => {
    const auth = await researcher('chi@ufl.edu', 'Chi Eze');
    await api.put('/api/researchers/me/profile').set(auth).send({ organizationType: 'university', organizationName: 'University of Florida', country: 'United States', role: 'PhD student' }).expect(200);
    await api.post('/api/researchers/me/founding-lab').set(auth).send({ action: 'maybe' }).expect(400);
    expect((await api.post('/api/researchers/me/founding-lab').set(auth).send({ action: 'dismiss' }).expect(200)).body.data.status).toBe('dismissed');
    expect((await home(auth)).founding).toBe('dismissed');

    const before = outbox.length;
    expect((await api.post('/api/researchers/me/founding-lab').set(auth).send({ action: 'apply' }).expect(200)).body.data.status).toBe('applied');
    await api.post('/api/researchers/me/founding-lab').set(auth).send({ action: 'apply' }).expect(200);
    expect(outbox.slice(before).filter((m) => /founding-lab/.test(m.subject))).toHaveLength(1);
    const lead = await LeadModel.findOne({ type: 'founding-lab', email: 'chi@ufl.edu' });
    expect(lead).toMatchObject({ name: 'Chi Eze', organization: 'University of Florida', country: 'United States', role: 'PhD student', source: 'dashboard' });
    await api.post('/api/researchers/me/founding-lab').set(auth).send({ action: 'dismiss' }).expect(200);
    expect((await home(auth)).founding).toBe('applied');
  });

  it('counts an application from the public page too', async () => {
    const auth = await researcher('lab@uct.ac.za', 'Lab Lead');
    await api.post('/api/leads').send({ type: 'founding-lab', email: 'lab@uct.ac.za', name: 'Lab Lead' }).expect(201);
    expect((await home(auth)).founding).toBe('applied');
  });
});
