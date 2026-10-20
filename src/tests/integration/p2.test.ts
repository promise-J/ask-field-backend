import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../app';
import { connectDB } from '../../config/database';
import { env } from '../../config/env';
import { outbox } from '../../utils/mailer';
import { signAccessToken } from '../../utils/jwt';
import { ParticipantModel } from '../../modules/user/models/participant.model';
import { approve } from '../../modules/billing/launch.service';
import { fitsStudy, profileMatches } from '../../modules/survey/plan';

/** Participant Stage 2: the "About you" profile, locks after verification, LinkedIn, and the researcher's new filters. */
const api = request(app);
const lastMail = (to: string, re: RegExp) => [...outbox].reverse().find((m) => m.to.includes(to) && re.test(m.subject));
type Auth = { Authorization: string };
let n = 0;

async function participant(country = 'Nigeria', extra: Record<string, unknown> = {}): Promise<Auth & { id: string }> {
  const p = await ParticipantModel.create({ email: `p2-${++n}@example.com`, firstName: 'Amaka', lastName: 'Eze', password: 'x-not-used-1', isVerified: true, country, ...extra });
  return { Authorization: `Bearer ${signAccessToken({ id: String(p._id), userType: 'participant' } as any)}`, id: String(p._id) };
}
const P = '/api/participants/me/profile';
const WHERE = { region: 'Lagos', birthMonth: 5, birthYear: 1994, gender: 'female' };
const LANGS = { firstLanguage: 'Igbo', languages: ['English', 'Nigerian Pidgin'] };
const WORK = { education: 'bachelor', student: 'no', work: 'self-employed', devices: ['android', 'computer'] };
async function fullProfile(p: Auth) {
  await api.put(`${P}/where`).set(p).send(WHERE).expect(200);
  await api.put(`${P}/languages`).set(p).send(LANGS).expect(200);
  return api.put(`${P}/work`).set(p).send(WORK).expect(200);
}

async function researcher(email: string): Promise<Auth> {
  await api.post('/api/researchers/auth/register').send({ fullName: 'Ada Obi', email, password: 'research-pass-1' }).expect(201);
  const url = new URL(lastMail(email, /verify/i)!.text.match(/https?:\/\/\S+/)![0]);
  const res = await api.get('/api/researchers/auth/verify-email').query({ email, token: url.searchParams.get('token') }).expect(200);
  const auth = { Authorization: `Bearer ${res.body.data.accessToken}` };
  await api.put('/api/researchers/me/profile').set(auth).send({ organizationType: 'university', organizationName: 'University of Florida', country: 'United States' }).expect(200);
  return auth;
}

beforeAll(async () => {
  await connectDB(process.env.MONGO_URI!.replace(/\/[^/]*$/, '/joinstudy_p2_test'));
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  env.REQUIRE_PARTICIPANT_VERIFICATION = false;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('2.1–2.4 About you, in three parts', () => {
  it('offers the lists for the person’s country', async () => {
    const gh = await participant('Ghana');
    const r = await api.get(P).set(gh).expect(200);
    expect(r.body.data.options.regionLabel).toBe('Region');
    expect(r.body.data.options.regions).toHaveLength(16);
    expect(r.body.data.options.languages).toContain('Twi');
    expect(r.body.data.options.genders.map((g: any) => g.value)).toEqual(['female', 'male']);
    expect(r.body.data.options.education.find((e: any) => e.value === 'secondary').label).toMatch(/WASSCE/);
    const ke = await participant('Kenya');
    expect((await api.get(P).set(ke)).body.data.options.regions).toHaveLength(47);
    const ng = await participant('Nigeria');
    expect((await api.get(P).set(ng)).body.data.options.regions).toHaveLength(37);
  });

  it('checks every answer, and only Female or Male', async () => {
    const p = await participant();
    expect((await api.put(`${P}/where`).set(p).send({ ...WHERE, region: 'Accra' }).expect(400)).body.message).toMatch(/state/);
    expect((await api.put(`${P}/where`).set(p).send({ ...WHERE, gender: 'non-binary' }).expect(400)).body.message).toMatch(/Female or Male/);
    expect((await api.put(`${P}/where`).set(p).send({ ...WHERE, birthYear: new Date().getUTCFullYear() - 17 }).expect(400)).body.message).toMatch(/18 or older/);
    expect((await api.put(`${P}/work`).set(p).send({ ...WORK, devices: [] }).expect(400)).body.message).toMatch(/device/);
    await api.put(`${P}/nonsense`).set(p).send({}).expect(404);
  });

  it('keeps month and year of birth only; complete after all three parts', async () => {
    const p = await participant();
    const one = await api.put(`${P}/where`).set(p).send(WHERE).expect(200);
    expect(one.body.data.complete).toBe(false);
    await api.put(`${P}/languages`).set(p).send(LANGS).expect(200);
    const done = await api.put(`${P}/work`).set(p).send(WORK).expect(200);
    expect(done.body.data.complete).toBe(true);
    expect(done.body.data.answers).toMatchObject({ region: 'Lagos', birthMonth: 5, birthYear: 1994, gender: 'female', firstLanguage: 'Igbo', languages: ['English', 'Nigerian Pidgin'], education: 'bachelor', devices: ['android', 'computer'] });
    const stored: any = await ParticipantModel.findById(p.id).lean();
    expect(new Date(stored.profile.dateOfBirth).toISOString().slice(0, 10)).toBe('1994-05-01');
    expect(stored.isCompleteProfile).toBe(true);
  });
});

describe('2.5 your profile: locks once verified', () => {
  it('birth date and gender lock after verification; the state can still change', async () => {
    const p = await participant();
    await fullProfile(p);
    await ParticipantModel.updateOne({ _id: p.id }, { $set: { 'verification.status': 'verified' } });
    const locked = await api.put(`${P}/where`).set(p).send({ ...WHERE, gender: 'male' }).expect(409);
    expect(locked.body.message).toMatch(/locked/);
    await api.put(`${P}/where`).set(p).send({ ...WHERE, birthYear: 1990 }).expect(409);
    const moved = await api.put(`${P}/where`).set(p).send({ ...WHERE, region: 'Abia' }).expect(200);
    expect(moved.body.data.answers.region).toBe('Abia');
    expect(moved.body.data.locked).toBe(true);
    // The old popup's endpoint can't get round it either.
    await api.post('/api/participants/auth/complete-profile').set(p).send({ gender: 'Male' }).expect(409);
  });
});

describe('LinkedIn (optional)', () => {
  it('connects in test mode, keeps only LinkedIn’s id, one LinkedIn per account', async () => {
    const p = await participant();
    const start = await api.post('/api/participants/me/linkedin/start').set(p).expect(200);
    expect(start.body.data.testMode).toBe(true);
    const u = new URL(start.body.data.url);
    expect(u.pathname).toBe('/participate/linkedin');
    await api.post('/api/participants/me/linkedin/complete').set(p).send({ code: 'x', state: 'wrong-state-123' }).expect(400);
    const done = await api.post('/api/participants/me/linkedin/complete').set(p).send({ code: u.searchParams.get('code'), state: u.searchParams.get('state') }).expect(200);
    expect(done.body.data.linkedin).toMatchObject({ connected: true, nameMatches: true });
    const me = await api.get('/api/participants/me').set(p).expect(200);
    expect(JSON.stringify(me.body.data)).not.toMatch(/"sub"|linkedinState/);
    const off = await api.delete('/api/participants/me/linkedin').set(p).expect(200);
    expect(off.body.data.linkedin.connected).toBe(false);

    // Someone else already has this LinkedIn: refused.
    const other = await participant();
    await ParticipantModel.updateOne({ _id: other.id }, { $set: { 'linkedin.sub': `test-${p.id}`, 'linkedin.connectedAt': new Date() } });
    const again = new URL((await api.post('/api/participants/me/linkedin/start').set(p).expect(200)).body.data.url);
    const taken = await api.post('/api/participants/me/linkedin/complete').set(p).send({ code: 'x', state: again.searchParams.get('state') }).expect(409);
    expect(taken.body.message).toMatch(/another joinStudy account/);
  });
});

describe('matching with the new answers', () => {
  const people = (extra: any = {}) => ({ profile: { countryOfResidence: 'Nigeria', region: 'Lagos', dateOfBirth: new Date(Date.UTC(1994, 4, 1)), gender: 'female', firstLanguage: 'Igbo', fluentLanguage: ['English'], educationLevel: 'bachelor', isStudent: 'no', employmentStatus: 'self-employed', devices: ['android'] }, ...extra });

  it('regions, Female/Male (old woman/man plans too), education keys, devices and LinkedIn-only', () => {
    const A = { countries: ['Nigeria'], minAge: 18, maxAge: 100 };
    expect(profileMatches({ ...A, regions: ['Lagos'] }, people()).ok).toBe(true);
    expect(profileMatches({ ...A, regions: ['Kano'] }, people()).ok).toBe(false);
    expect(profileMatches({ ...A, genders: ['female'] }, people()).ok).toBe(true);
    expect(profileMatches({ ...A, genders: ['woman'] }, people()).ok).toBe(true);
    expect(profileMatches({ ...A, genders: ['male'] }, people()).ok).toBe(false);
    expect(profileMatches({ ...A, education: 'degree' }, people()).ok).toBe(true);
    expect(profileMatches({ ...A, education: 'postgraduate' }, people()).ok).toBe(false);
    expect(profileMatches({ ...A, languages: ['Igbo'] }, people()).ok).toBe(true);
    expect(fitsStudy({ audience: A, setup: { devices: ['computer'] } }, people()).ok).toBe(false);
    expect(fitsStudy({ audience: A, setup: { devices: ['computer'] } }, people({ profile: { ...people().profile, devices: ['computer'] } })).ok).toBe(true);
    expect(fitsStudy({ audience: { ...A, linkedinOnly: true }, setup: {} }, people()).ok).toBe(false);
    expect(fitsStudy({ audience: { ...A, linkedinOnly: true }, setup: {} }, people({ linkedin: { connectedAt: new Date() } })).ok).toBe(true);
  });

  it('researchers can recruit in Ghana and Kenya, by region, and see only verified people counted', async () => {
    env.REQUIRE_PARTICIPANT_VERIFICATION = true;
    const ada = await researcher('ada.p2@ufl.edu');
    const opts = await api.get('/api/participant-options').expect(200);
    expect(opts.body.data.countries).toEqual(['Nigeria', 'Ghana', 'Kenya']);
    const s = await api.post('/api/surveys/start').set(ada).send({ method: 'survey' }).expect(201);
    const id = s.body.data.surveyId;
    const bad = await api.put(`/api/surveys/${id}/plan/audience`).set(ada).send({ data: { countries: ['Ghana'], regions: ['Lagos'], genders: ['female'] }, final: true }).expect(400);
    expect(JSON.stringify(bad.body)).toMatch(/places in the countries/);
    await api.put(`/api/surveys/${id}/plan/audience`).set(ada).send({ data: { countries: ['Ghana', 'Kenya'], regions: ['Greater Accra', 'Nairobi'], genders: ['female'], languages: ['Twi'] }, final: true }).expect(200);

    const kofi = await participant('Ghana');
    await api.put(`${P}/where`).set(kofi).send({ ...WHERE, region: 'Greater Accra' }).expect(200);
    await api.put(`${P}/languages`).set(kofi).send({ firstLanguage: 'Twi', languages: ['English'] }).expect(200);
    await api.put(`${P}/work`).set(kofi).send(WORK).expect(200);
    const unverified = await api.get(`/api/surveys/${id}/plan/match`).set(ada).expect(200);
    expect(unverified.body.data.count).toBe(0);
    await ParticipantModel.updateOne({ _id: kofi.id }, { $set: { 'verification.status': 'verified' } });
    const verified = await api.get(`/api/surveys/${id}/plan/match`).set(ada).expect(200);
    expect(verified.body.data.count).toBe(1);
    env.REQUIRE_PARTICIPANT_VERIFICATION = false;
  });

  it('a live study in Ghana: a fitting, verified Ghanaian qualifies', async () => {
    env.REQUIRE_PARTICIPANT_VERIFICATION = true;
    const ada = await researcher('ada2.p2@ufl.edu');
    const s = await api.post('/api/surveys/start').set(ada).send({ method: 'survey' }).expect(201);
    const id = s.body.data.surveyId;
    const plan: Record<string, object> = {
      basics: { title: 'Mobile money in Accra', description: 'A short study.', consent: { mode: 'own', text: '' } },
      audience: { countries: ['Ghana'], regions: ['Greater Accra'], minAge: 18, maxAge: 100 },
      setup: { url: 'https://forms.example/accra', minutes: 10, devices: ['phone'] },
      pay: { perPerson: 3, places: 10 },
    };
    for (const step of ['basics', 'audience', 'setup', 'pay']) await api.put(`/api/surveys/${id}/plan/${step}`).set(ada).send({ data: plan[step], final: true }).expect(200);
    const r = await api.post(`/api/surveys/${id}/launch/pay`).set(ada).send({ method: 'card', agree: true, receipt: { name: 'Ada Obi', email: 'ada2.p2@ufl.edu', country: 'United States' } }).expect(201);
    await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(ada).expect(200);
    await approve(id);

    const ama = await participant('Ghana', { 'verification.status': 'verified' });
    await api.put(`${P}/where`).set(ama).send({ ...WHERE, region: 'Greater Accra' }).expect(200);
    await api.put(`${P}/languages`).set(ama).send({ firstLanguage: 'Twi', languages: [] }).expect(200);
    await api.put(`${P}/work`).set(ama).send(WORK).expect(200);
    const v = await api.get('/api/participants/me/verification').set(ama).expect(200);
    expect(v.body.data.qualifying.count).toBe(1);
    await api.get(`/api/surveys/check-eligibility/${id}`).set(ama).expect(200);

    const kumasi = await participant('Ghana', { 'verification.status': 'verified' });
    await api.put(`${P}/where`).set(kumasi).send({ ...WHERE, region: 'Ashanti' }).expect(200);
    await api.put(`${P}/languages`).set(kumasi).send({ firstLanguage: 'Twi', languages: [] }).expect(200);
    await api.put(`${P}/work`).set(kumasi).send(WORK).expect(200);
    const no = await api.get(`/api/surveys/check-eligibility/${id}`).set(kumasi).expect(403);
    expect(no.body.message).toMatch(/other places/);
    env.REQUIRE_PARTICIPANT_VERIFICATION = false;
  });
});
