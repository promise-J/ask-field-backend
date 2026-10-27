import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../app';
import { connectDB } from '../../config/database';
import { config } from '../../config/env';
import { outbox } from '../../utils/mailer';
import { signAccessToken } from '../../utils/jwt';
import { ParticipantModel } from '../../modules/user/models/participant.model';
import { SurveyActionModel, SurveyModel } from '../../modules/survey/survey.model';
import { missingByStep, profileMatches, quotaGroupOf } from '../../modules/survey/plan';
import { approve } from '../../modules/billing/launch.service';

/** Stage 4: the study planner (basics, who you need, method setup, pay and timing), and what it changes for participants. */
const api = request(app);
const PASS = 'research-pass-1';
const lastMail = (to: string, re: RegExp) => [...outbox].reverse().find((m) => m.to === to && re.test(m.subject));
type Auth = { Authorization: string };

async function researcher(email: string, fullName = 'Ada Obi'): Promise<Auth> {
  await api.post('/api/researchers/auth/register').send({ fullName, email, password: PASS }).expect(201);
  const url = new URL(lastMail(email, /verify/i)!.text.match(/https?:\/\/\S+/)![0]);
  const res = await api.get('/api/researchers/auth/verify-email').query({ email, token: url.searchParams.get('token') }).expect(200);
  const auth = { Authorization: `Bearer ${res.body.data.accessToken}` };
  await api.put('/api/researchers/me/profile').set(auth).send({ organizationType: 'university', organizationName: 'University of Florida', country: 'United States' }).expect(200);
  return auth;
}

let n = 0;
async function participant(profile: Record<string, unknown>): Promise<Auth> {
  const p = await ParticipantModel.create({ email: `p${++n}@example.com`, firstName: 'P', lastName: String(n), password: 'x-not-used-1', isVerified: true, isCompleteProfile: true, profile });
  return { Authorization: `Bearer ${signAccessToken({ id: String(p._id), userType: 'participant' } as any)}` };
}
const born = (age: number) => new Date(new Date().getFullYear() - age, 0, 1);

const put = (auth: Auth, id: string, step: string, data: object, final = false) => api.put(`/api/surveys/${id}/plan/${step}`).set(auth).send({ data, final });

const SURVEY_PLAN = {
  basics: { title: 'How Lagos commuters get to work', description: 'A 15-minute survey about getting to work.', sensitive: false, consent: { mode: 'joinstudy', text: 'You can stop at any time.' }, ethics: { body: 'UF IRB', reference: 'IRB2026' } },
  audience: { countries: ['Nigeria'], minAge: 21, maxAge: 60, genders: [], languages: ['Yoruba', 'Igbo'], questions: [{ text: 'How do you get to work?', answers: [{ text: 'Bus', qualifies: true }, { text: 'Car', qualifies: true }, { text: 'I work from home', qualifies: false }] }] },
  setup: { url: 'https://forms.example/lagos', passParticipantId: true, minutes: 15, devices: ['phone', 'computer'] },
  pay: { perPerson: 3, places: 2 },
};

beforeAll(async () => {
  await connectDB(process.env.MONGO_URI!.replace(/\/[^/]*$/, '/joinstudy_stage4_test'));
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('planner', () => {
  let auth: Auth;
  let id: string;

  it('a new study starts with what we know, a return link, and a list of what is missing', async () => {
    auth = await researcher('ada@ufl.edu');
    const s = await api.post('/api/surveys/start').set(auth).send({ method: 'survey', estimate: { participants: 50, minutes: 15, ratePerHour: 12 } }).expect(201);
    id = s.body.data.surveyId;
    const v = (await api.get(`/api/surveys/${id}/plan`).set(auth).expect(200)).body.data;
    expect(v.plan.basics.title).toBe('Untitled survey');
    expect(v.plan.pay).toMatchObject({ perPerson: 3, places: 50 });
    expect(v.returnLink).toMatch(/\/done\/[A-Z2-9]{4}-[A-Z2-9]{2}$/);
    expect(v.done).toMatchObject({ basics: false, audience: true, setup: false, pay: true });
    expect(v.missing.basics).toEqual(['Paste your consent information, or choose “I collect it myself”.']);
    expect(v.missing.setup).toEqual(['Add the link participants will open.']);
    expect(v.figures).toMatchObject({ places: 50, minutes: 15, perPerson: 3, hourly: 12, feeRate: 0.18, pay: 150, fee: 27, total: 177 });
  });

  it('autosave keeps what is valid and points at what is not', async () => {
    const r = await put(auth, id, 'setup', { url: 'not a link', minutes: 20, devices: ['phone'] }).expect(200);
    expect(r.body.data.fields).toEqual({ url: 'Enter your survey link, starting with https://' });
    expect(r.body.data.plan.setup).toMatchObject({ minutes: 20, devices: ['phone'] });
  });

  it('"Save and continue" refuses an unfinished step and says which fields', async () => {
    // Participant Stage 2 opened Ghana and Kenya; anywhere else is still refused.
    const r = await put(auth, id, 'audience', { countries: ['Togo'], minAge: 40, maxAge: 30 }, true).expect(400);
    expect(r.body.code).toBe('step_incomplete');
    expect(r.body.data.fields).toMatchObject({ countries: 'We can recruit in Nigeria, Ghana, Kenya right now.' });
    const q = await put(auth, id, 'audience', { questions: [{ text: 'Q?', answers: [{ text: 'A', qualifies: true }, { text: 'B', qualifies: true }] }] }, true).expect(400);
    expect(q.body.data.fields.questions).toMatch(/screens nobody out/);
  });

  it('a complete plan is ready, and older fields stay in step for participant pages', async () => {
    for (const step of ['basics', 'audience', 'setup', 'pay'] as const) await put(auth, id, step, (SURVEY_PLAN as any)[step], true).expect(200);
    const v = (await api.get(`/api/surveys/${id}/plan`).set(auth).expect(200)).body.data;
    expect(v.ready).toBe(true);
    const s: any = await SurveyModel.findById(id);
    expect(s).toMatchObject({ surveyName: 'How Lagos commuters get to work', surveyURL: 'https://forms.example/lagos', minimumAge: 21, maximumAge: 60, numberOfParticipants: 2, surveyDuration: 15, surveyAmount: 3, surveyType: 'external' });
  });

  it('counts real participants who match, including people born there when asked', async () => {
    await participant({ countryOfResidence: 'Nigeria', dateOfBirth: born(30), gender: 'Female', firstLanguage: 'Yoruba' });
    await participant({ countryOfResidence: 'Nigeria', dateOfBirth: born(35), gender: 'Male', fluentLanguage: 'English, Igbo' });
    await participant({ countryOfResidence: 'Nigeria', dateOfBirth: born(19), gender: 'Male', firstLanguage: 'Yoruba' }); // too young
    await participant({ countryOfResidence: 'Nigeria', dateOfBirth: born(30), gender: 'Male', firstLanguage: 'Hausa' }); // language
    await participant({ countryOfResidence: 'USA', countryOfBirth: 'Nigeria', dateOfBirth: born(40), gender: 'Female', firstLanguage: 'Igbo' }); // diaspora
    expect((await api.get(`/api/surveys/${id}/plan/match`).set(auth).expect(200)).body.data).toMatchObject({ count: 2, total: 5 });
    await put(auth, id, 'audience', { includeDiaspora: true }).expect(200);
    expect((await api.get(`/api/surveys/${id}/plan/match`).set(auth).expect(200)).body.data.count).toBe(3);
  });

  it('interviews keep their own setup; they launch through payment like any study (Stage 6)', async () => {
    const s = await api.post('/api/surveys/start').set(auth).send({ method: 'interview' }).expect(201);
    const iid = s.body.data.surveyId;
    const bad = await put(auth, iid, 'setup', { count: 12, minutes: 45, videoMode: 'one', timeZone: 'America/New_York', from: '2026-10-26', to: '2026-11-06', weekly: [] }, true).expect(400);
    expect(bad.body.data.fields).toEqual({ weekly: 'Choose at least one time you’re free.' });
    const noLink = await put(auth, iid, 'setup', { weekly: ['Mon 09:00', 'Tue 10:00'] }, true).expect(400);
    expect(noLink.body.data.fields).toEqual({ videoUrl: 'Add your meeting link, or choose a new link each time.' });
    await put(auth, iid, 'setup', { videoUrl: 'https://ufl.zoom.us/j/1' }, true).expect(200);
    await put(auth, iid, 'basics', { title: 'Teachers and AI', consent: { mode: 'own', text: '' } }, true).expect(200);
    await put(auth, iid, 'pay', { perPerson: 15 }, true).expect(200);
    const v = (await api.get(`/api/surveys/${iid}/plan`).set(auth).expect(200)).body.data;
    expect(v).toMatchObject({ ready: true, returnLink: null, figures: { places: 12, minutes: 45, hourly: 20 } });
    const pub = await api.post(`/api/surveys/publish-draft-survey/${iid}`).set(auth).expect(402);
    expect(pub.body.code).toBe('payment_required');
  });

  it('pay under the minimum hourly rate blocks launch, once a minimum is set', () => {
    const before = config.minHourlyPay;
    (config as any).minHourlyPay = 13;
    try {
      expect(missingByStep('survey', SURVEY_PLAN).pay).toEqual(['Pay is below the minimum of 13 an hour.']);
    } finally {
      (config as any).minHourlyPay = before;
    }
  });

  it('an unfinished planner study cannot launch', async () => {
    const s = await api.post('/api/surveys/start').set(auth).send({ method: 'product-test' }).expect(201);
    const r = await api.post(`/api/surveys/publish-draft-survey/${s.body.data.surveyId}`).set(auth).expect(400);
    expect(r.body.code).toBe('plan_incomplete');
  });

  it('launches the finished survey (paid, then approved by us; Stage 5)', async () => {
    const r = await api.post(`/api/surveys/${id}/launch/pay`).set(auth).send({ method: 'card', agree: true, receipt: { name: 'Ada Obi', email: 'ada@ufl.edu', country: 'United States' } }).expect(201);
    await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(auth).expect(200);
    await approve(id);
    await put(auth, id, 'basics', { title: 'Changed' }).expect(409);
  });
});

describe('participants and a planner study', () => {
  let id: string;
  let code: string;
  beforeAll(async () => {
    const s: any = await SurveyModel.findOne({ surveyName: 'How Lagos commuters get to work' });
    id = String(s._id);
    code = s.returnCode;
  });

  it('participants never see the qualifying answers or the return code', async () => {
    const p = await participant({ countryOfResidence: 'Nigeria', dateOfBirth: born(28), gender: 'Female', firstLanguage: 'Igbo' });
    const list = await api.get('/api/surveys/get-all-surveys').set(p).expect(200);
    const s = list.body.data.find((x: any) => x.surveyId === id);
    expect(s.plan).toBeUndefined();
    expect(s.returnCode).toBeUndefined();
    expect(s.participantView).toMatchObject({ consent: { required: true, text: 'You can stop at any time.' }, ethics: 'UF IRB, IRB2026', hasQuestions: true });
    expect(JSON.stringify(s)).not.toMatch(/qualifies/);
  });

  it('profile filters come first, in plain words', async () => {
    const young = await participant({ countryOfResidence: 'Nigeria', dateOfBirth: born(19), gender: 'Female', firstLanguage: 'Igbo' });
    const r = await api.get(`/api/surveys/check-eligibility/${id}`).set(young).expect(403);
    expect(r.body.message).toBe('This study is for people aged 21–60.');
    const hausa = await participant({ countryOfResidence: 'Nigeria', dateOfBirth: born(30), gender: 'Male', firstLanguage: 'Hausa' });
    expect((await api.get(`/api/surveys/check-eligibility/${id}`).set(hausa).expect(403)).body.code).toBe('not_eligible');
  });

  it('then the researcher’s questions: a wrong answer screens them out for good', async () => {
    const p = await participant({ countryOfResidence: 'Nigeria', dateOfBirth: born(30), gender: 'Male', firstLanguage: 'Yoruba' });
    const ask = await api.get(`/api/surveys/check-eligibility/${id}`).set(p).expect(409);
    expect(ask.body).toMatchObject({ code: 'screener_required', data: { questions: [{ text: 'How do you get to work?', answers: ['Bus', 'Car', 'I work from home'] }] } });
    expect((await api.post(`/api/surveys/${id}/screen`).set(p).send({ answers: [2] }).expect(403)).body.code).toBe('screened_out');
    expect((await api.post(`/api/surveys/${id}/screen`).set(p).send({ answers: [0] }).expect(403)).body.code).toBe('screened_out');
  });

  it('a qualifying answer starts them; consent is needed for the link, which carries their ID', async () => {
    const p = await participant({ countryOfResidence: 'Nigeria', dateOfBirth: born(30), gender: 'Female', fluentLanguage: 'Yoruba' });
    const a = await api.post(`/api/surveys/${id}/screen`).set(p).send({ answers: [1] }).expect(200);
    expect(a.body.data.status).toBe('in-progress');
    expect((await api.post(`/api/surveys/${id}/start-link`).set(p).send({}).expect(400)).body.code).toBe('consent_required');
    const link = await api.post(`/api/surveys/${id}/start-link`).set(p).send({ consent: true }).expect(200);
    expect(link.body.data.url).toBe(`https://forms.example/lagos?jsid=${a.body.data.surveyActionId}`);
    expect((await SurveyActionModel.findById(a.body.data.surveyActionId))!.get('consentedAt')).toBeInstanceOf(Date);

    // The return link at the end of the survey marks it finished.
    await api.post('/api/surveys/done/ZZZZ-ZZ').set(p).expect(404);
    const done = await api.post(`/api/surveys/done/${code.toLowerCase()}`).set(p).expect(200);
    expect(done.body.data.status).toBe('submitted');
  });
});

describe('matching rules', () => {
  const A = { countries: ['Nigeria'], minAge: 18, maxAge: 100 };
  it('education, work and students need the profile to answer', () => {
    const p = (profile: object) => ({ profile: { countryOfResidence: 'Nigeria', dateOfBirth: born(30), ...profile } });
    expect(profileMatches({ ...A, education: 'degree' }, p({ educationLevel: 'BSc' })).ok).toBe(true);
    expect(profileMatches({ ...A, education: 'degree' }, p({ educationLevel: 'HND' })).ok).toBe(false);
    expect(profileMatches({ ...A, education: 'postgraduate' }, p({ educationLevel: 'MSc' })).ok).toBe(true);
    expect(profileMatches({ ...A, employment: 'self-employed' }, p({ employmentStatus: 'Self Employed' })).ok).toBe(true);
    expect(profileMatches({ ...A, employment: 'employed' }, p({})).ok).toBe(false);
    expect(profileMatches({ ...A, students: 'exclude' }, p({ isStudent: 'YES' })).ok).toBe(false);
    expect(profileMatches({ ...A, genders: ['woman'] }, p({ gender: 'Female' })).ok).toBe(true);
  });
  it('quota groups by gender or language', () => {
    const q = { by: 'gender', groups: [{ value: 'woman', places: 5 }, { value: 'man', places: 5 }] };
    expect(quotaGroupOf({ quota: q }, { profile: { gender: 'Female' } })).toBe('woman');
    expect(quotaGroupOf({ quota: { by: 'language', groups: [{ value: 'Igbo', places: 3 }, { value: 'Yoruba', places: 3 }] } }, { profile: { fluentLanguage: 'English, Yoruba' } })).toBe('Yoruba');
    expect(quotaGroupOf({}, { profile: {} })).toBeNull();
  });
});
