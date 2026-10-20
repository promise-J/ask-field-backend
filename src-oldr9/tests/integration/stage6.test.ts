import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../app';
import { connectDB } from '../../config/database';
import { outbox } from '../../utils/mailer';
import { signAccessToken } from '../../utils/jwt';
import { ParticipantModel } from '../../modules/user/models/participant.model';
import { SurveyActionModel, SurveyModel } from '../../modules/survey/survey.model';
import { TransactionModel } from '../../modules/wallet/transaction.model';
import { approve } from '../../modules/billing/launch.service';
import { BookingModel } from '../../modules/run/booking.model';
import { MessageModel } from '../../modules/run/message.model';
import { sendDueReminders } from '../../modules/run/booking.service';
import { checkBody } from '../../modules/run/message.service';

/** Stage 6: run a live study. Progress, pause, add places, close early, bookings, reminders, messages. */
const api = request(app);
const PASS = 'research-pass-1';
const lastMail = (to: string, re: RegExp) => [...outbox].reverse().find((m) => m.to.includes(to) && re.test(m.subject));
type Auth = { Authorization: string };
let n = 0;

async function researcher(email: string): Promise<Auth> {
  await api.post('/api/researchers/auth/register').send({ fullName: 'Ada Obi', email, password: PASS }).expect(201);
  const url = new URL(lastMail(email, /verify/i)!.text.match(/https?:\/\/\S+/)![0]);
  const res = await api.get('/api/researchers/auth/verify-email').query({ email, token: url.searchParams.get('token') }).expect(200);
  const auth = { Authorization: `Bearer ${res.body.data.accessToken}` };
  await api.put('/api/researchers/me/profile').set(auth).send({ organizationType: 'university', organizationName: 'University of Florida', country: 'United States' }).expect(200);
  return auth;
}
async function participant(): Promise<Auth & { id: string; email: string }> {
  const email = `p6-${++n}@example.com`;
  const p = await ParticipantModel.create({ email, firstName: 'P', lastName: String(n), password: 'x-not-used-1', isVerified: true, isCompleteProfile: true, profile: { countryOfResidence: 'Nigeria', dateOfBirth: new Date(1990, 0, 1) } });
  return { Authorization: `Bearer ${signAccessToken({ id: String(p._id), userType: 'participant' } as any)}`, id: String(p._id), email };
}
const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const RECEIPT = { name: 'Ada Obi', organization: 'University of Florida', email: 'ada6@ufl.edu', cc: '', reference: '', country: 'United States' };
const BASICS = { title: 'How Lagos commuters get to work', description: 'A short study about getting to work in Lagos.', consent: { mode: 'own', text: '' } };
const AUDIENCE = { countries: ['Nigeria'], minAge: 18, maxAge: 100 };

async function liveStudy(auth: Auth, method: string, plan: Record<string, object>) {
  const s = await api.post('/api/surveys/start').set(auth).send({ method }).expect(201);
  const id = s.body.data.surveyId as string;
  const full = { basics: BASICS, audience: AUDIENCE, ...plan } as Record<string, object>;
  for (const step of ['basics', 'audience', 'setup', 'pay']) await api.put(`/api/surveys/${id}/plan/${step}`).set(auth).send({ data: full[step], final: true }).expect(200);
  const r = await api.post(`/api/surveys/${id}/launch/pay`).set(auth).send({ method: 'card', agree: true, receipt: RECEIPT }).expect(201);
  await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(auth).expect(200);
  await approve(id);
  return id;
}
const join = (p: Auth, id: string) => api.get(`/api/surveys/check-eligibility/${id}`).set(p);

beforeAll(async () => {
  await connectDB(process.env.MONGO_URI!.replace(/\/[^/]*$/, '/joinstudy_stage6_test'));
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('a live survey', () => {
  let auth: Auth;
  let id: string;
  let code: string;
  const people: Awaited<ReturnType<typeof participant>>[] = [];

  beforeAll(async () => {
    auth = await researcher('ada6@ufl.edu');
    id = await liveStudy(auth, 'survey', { setup: { url: 'https://forms.example/lagos', minutes: 15, devices: ['phone'] }, pay: { perPerson: 1000, places: 10 } });
    code = String((await SurveyModel.findById(id))!.get('returnCode'));
    for (let i = 0; i < 3; i++) people.push(await participant());
  });

  it('counts finished, in progress and stuck; shows the money held', async () => {
    for (const p of people) await join(p, id).expect(200);
    await api.post(`/api/surveys/done/${code}`).set(people[0]).expect(200);
    // Someone who started 3 hours ago and never came back: probably the survey forgot to send them to the finish link.
    await SurveyActionModel.updateOne({ surveyId: id, participantId: people[1].id }, { $set: { startedAt: new Date(Date.now() - 3 * 3600e3) } });
    const v = (await api.get(`/api/surveys/${id}/live`).set(auth).expect(200)).body.data;
    expect(v).toMatchObject({ status: 'live', paused: false, places: 10, minutes: 15, counts: { approved: 0, toReview: 1, inProgress: 2, left: 9 }, money: { paidIn: 11800, paidOut: 0, held: 11800 } });
    expect(v.stuck).toEqual([{ code: 'P-02', participantSince: expect.any(String) }]);
    expect(v.perDay).toHaveLength(7);
    expect(v.perDay[6].count).toBe(1);
    expect(v.returnLink).toMatch(new RegExp(`/done/${code}$`));
    const list = (await api.get(`/api/surveys/${id}/participants`).set(auth).expect(200)).body.data;
    expect(list.map((x: any) => x.code).sort()).toEqual(['P-01', 'P-02', 'P-03']);
    expect(JSON.stringify(list)).not.toMatch(/@example\.com/);
  });

  it('only the owner sees it', async () => {
    const other = await researcher('kemi6@ufl.edu');
    await api.get(`/api/surveys/${id}/live`).set(other).expect(404);
    await api.post(`/api/surveys/${id}/live/pause`).set(other).expect(404);
    await api.get(`/api/surveys/${id}/live`).set(people[0]).expect(403);
  });

  it('pause stops new people joining; people already in carry on', async () => {
    await api.post(`/api/surveys/${id}/live/pause`).set(auth).expect(200);
    const newcomer = await participant();
    expect((await join(newcomer, id).expect(403)).body.code).toBe('paused');
    const list = (await api.get('/api/surveys/get-all-surveys').set(newcomer).expect(200)).body.data;
    expect(list.map((x: any) => x.surveyId)).not.toContain(id);
    await join(people[2], id).expect(200);
    const v = (await api.post(`/api/surveys/${id}/live/resume`).set(auth).expect(200)).body.data;
    expect(v.paused).toBe(false);
    await join(newcomer, id).expect(200);
    people.push(newcomer);
  });

  it('a close date can be set or removed, not in the past', async () => {
    expect((await api.post(`/api/surveys/${id}/live/close-date`).set(auth).send({ date: day(-2) }).expect(400)).body.message).toMatch(/today or a later/);
    expect((await api.post(`/api/surveys/${id}/live/close-date`).set(auth).send({ date: day(10) }).expect(200)).body.data.closes).toBe(day(10));
    expect((await api.post(`/api/surveys/${id}/live/close-date`).set(auth).send({ date: null }).expect(200)).body.data.closes).toBeNull();
  });

  it('add places: pay for them, and they appear once paid', async () => {
    expect((await api.post(`/api/surveys/${id}/live/add-places`).set(auth).send({ extra: 0 }).expect(400)).body.message).toMatch(/at least 1/);
    const r = await api.post(`/api/surveys/${id}/live/add-places`).set(auth).send({ extra: 5, method: 'card' }).expect(201);
    expect(r.body.data).toMatchObject({ status: 'pending', provider: 'test', amount: 5900, extra: 5 });
    expect((await api.get(`/api/surveys/${id}/live`).set(auth).expect(200)).body.data.places).toBe(10);
    await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(auth).expect(200);
    const v = (await api.get(`/api/surveys/${id}/live`).set(auth).expect(200)).body.data;
    expect(v).toMatchObject({ places: 15, status: 'live', money: { paidIn: 17700 } });
    const s: any = await SurveyModel.findById(id);
    expect(s.numberOfParticipants).toBe(15);
    expect(s.launchStage).toBe('none'); // no second review for more places
    expect(lastMail('ada6@ufl.edu', /^Receipt JS-/)).toBeTruthy();
  });

  describe('messages', () => {
    it('to one participant: they get an email and see it in their inbox; no contact details either way', async () => {
      const [p] = people;
      const sent = await api.post(`/api/surveys/${id}/messages`).set(auth).send({ to: p.id, body: 'Thanks! Did the last page load for you?' }).expect(201);
      expect(sent.body.data).toMatchObject({ sent: 1, broadcast: false, message: { from: 'researcher' } });
      expect(lastMail(p.email, /New message about "How Lagos commuters/)!.text).toMatch(/Did the last page load/);
      expect(lastMail(p.email, /New message/)!.text).not.toMatch(/ada6@ufl\.edu/);
      const inbox = (await api.get('/api/participants/me/messages').set(p).expect(200)).body.data;
      expect(inbox).toMatchObject({ unread: 1, threads: [{ surveyId: id, study: 'How Lagos commuters get to work', unread: 1 }] });
      const thread = (await api.get(`/api/participants/me/messages/${id}`).set(p).expect(200)).body.data;
      expect(thread.messages).toHaveLength(1);
      expect(thread.researcher).toEqual({ name: 'Ada Obi', organization: 'University of Florida' });
      expect((await api.get('/api/participants/me/messages').set(p).expect(200)).body.data.unread).toBe(0);

      const bad = await api.post(`/api/participants/me/messages/${id}`).set(p).send({ body: 'Call me on 0803 123 4567' }).expect(400);
      expect(bad.body.code).toBe('contact_details');
      expect((await api.post(`/api/surveys/${id}/messages`).set(auth).send({ to: p.id, body: 'Email me at ada@ufl.edu' }).expect(400)).body.code).toBe('contact_details');
      await api.post(`/api/participants/me/messages/${id}`).set(p).send({ body: 'Yes, it loaded fine.' }).expect(201);
      expect(lastMail('ada6@ufl.edu', /P-01 replied/)).toBeTruthy();
    });

    it('a burst of messages sends one email, not one each', async () => {
      const [p] = people;
      const before = outbox.filter((m) => m.to.includes('ada6@ufl.edu') && /replied/.test(m.subject)).length;
      await api.post(`/api/participants/me/messages/${id}`).set(p).send({ body: 'One more thing.' }).expect(201);
      expect(outbox.filter((m) => m.to.includes('ada6@ufl.edu') && /replied/.test(m.subject)).length).toBe(before);
    });

    it('the researcher sees threads by code with unread counts; opening one marks it read', async () => {
      const threads = (await api.get(`/api/surveys/${id}/messages`).set(auth).expect(200)).body.data;
      expect(threads).toMatchObject([{ participantId: people[0].id, code: 'P-01', unread: 2, count: 3 }]);
      expect((await api.get('/api/researchers/me/messages').set(auth).expect(200)).body.data.unread).toBe(2);
      const t = (await api.get(`/api/surveys/${id}/messages/${people[0].id}`).set(auth).expect(200)).body.data;
      expect(t).toMatchObject({ code: 'P-01', study: 'How Lagos commuters get to work' });
      expect(t.messages.map((m: any) => m.from)).toEqual(['researcher', 'participant', 'participant']);
      expect((await api.get('/api/researchers/me/messages').set(auth).expect(200)).body.data.unread).toBe(0);
    });

    it('to everyone taking part: one copy in each person’s thread', async () => {
      const r = await api.post(`/api/surveys/${id}/messages`).set(auth).send({ to: 'everyone', body: 'Reminder: please finish by Friday.' }).expect(201);
      expect(r.body.data).toMatchObject({ sent: 4, broadcast: true });
      const inbox = (await api.get('/api/participants/me/messages').set(people[3]).expect(200)).body.data;
      expect(inbox.threads[0].last).toMatchObject({ from: 'researcher', body: 'Reminder: please finish by Friday.' });
    });

    it('nobody can write into a study they aren’t part of', async () => {
      const stranger = await participant();
      await api.post(`/api/participants/me/messages/${id}`).set(stranger).send({ body: 'Hello?' }).expect(404);
      await api.post(`/api/surveys/${id}/messages`).set(auth).send({ to: stranger.id, body: 'Hi' }).expect(404);
    });

    it('the contact check allows meeting links', () => {
      expect(checkBody('Join at https://ufl.zoom.us/j/12345678901?pwd=abc')).toMatch(/zoom/);
      expect(() => checkBody('+234 803 123 4567')).toThrow(/phone numbers/);
    });
  });

  it('close early: nobody new, people mid-way get 2 hours to finish', async () => {
    const v = (await api.post(`/api/surveys/${id}/live/close`).set(auth).expect(200)).body.data;
    expect(v.status).toBe('closed');
    expect((await join(await participant(), id).expect(403)).body.message).toMatch(/no longer taking participants/);
    await api.post(`/api/surveys/done/${code}`).set(people[1]).expect(200);
    await SurveyModel.updateOne({ _id: id }, { $set: { closedAt: new Date(Date.now() - 3 * 3600e3) } });
    expect((await api.post(`/api/surveys/done/${code}`).set(people[2]).expect(409)).body.code).toBe('study_closed');
  });
});

describe('interviews', () => {
  let auth: Auth;
  let id: string;
  const SETUP = { count: 3, minutes: 30, gapMinutes: 15, videoMode: 'one', videoUrl: 'https://ufl.zoom.us/j/1', timeZone: 'UTC', from: day(2), to: day(9), weekly: ['Mon 09:00', 'Tue 09:00', 'Wed 09:00', 'Thu 09:00', 'Fri 09:00', 'Sat 09:00', 'Sun 09:00'] };

  beforeAll(async () => {
    auth = await researcher('tunde6@ufl.edu');
    id = await liveStudy(auth, 'interview', {
      basics: { ...BASICS, title: 'Teachers and AI', consent: { mode: 'joinstudy', text: 'You can stop at any time.' } },
      setup: SETUP,
      pay: { perPerson: 5000 },
    });
  });

  it('launch through payment and our check, like any study', async () => {
    expect((await SurveyModel.findById(id))!.status).toBe('published');
  });

  it('participants consent, then choose a time; one booking each', async () => {
    const p = await participant();
    await join(p, id).expect(200);
    expect((await api.get(`/api/surveys/${id}/slots`).set(p).expect(400)).body.code).toBe('consent_required');
    const link = (await api.post(`/api/surveys/${id}/start-link`).set(p).send({ consent: true }).expect(200)).body.data;
    expect(link).toMatchObject({ book: true, url: expect.stringMatching(new RegExp(`/dashboard/participant/studies/${id}/book$`)) });
    const slots = (await api.get(`/api/surveys/${id}/slots`).set(p).expect(200)).body.data;
    expect(slots.minutes).toBe(30);
    expect(slots.slots.length).toBe(8);
    expect(slots.slots[0].start).toBe(`${day(2)}T09:00:00.000Z`);
    const b = await api.post(`/api/surveys/${id}/book`).set(p).send({ start: slots.slots[0].start, timeZone: 'Africa/Lagos' }).expect(201);
    expect(b.body.data).toMatchObject({ status: 'booked', videoUrl: 'https://ufl.zoom.us/j/1', title: 'Teachers and AI', canChange: true });
    expect(lastMail(p.email, /^Booked: Teachers and AI/)!.text).toMatch(/10:00/); // 09:00 UTC is 10:00 in Lagos
    expect(lastMail('tunde6@ufl.edu', /New booking: P-01/)).toBeTruthy();
    expect((await api.post(`/api/surveys/${id}/book`).set(p).send({ start: slots.slots[1].start }).expect(409)).body.code).toBe('already_booked');

    const q = await participant();
    await join(q, id).expect(200);
    await api.post(`/api/surveys/${id}/start-link`).set(q).send({ consent: true }).expect(200);
    expect((await api.post(`/api/surveys/${id}/book`).set(q).send({ start: slots.slots[0].start }).expect(409)).body.code).toBe('slot_taken');
    await api.post(`/api/surveys/${id}/book`).set(q).send({ start: slots.slots[1].start }).expect(201);
    const mine = (await api.get('/api/participants/me/bookings').set(q).expect(200)).body.data;
    expect(mine).toHaveLength(1);

    // The researcher sees bookings by code; 3 interviews wanted, 2 booked, so times are still open.
    const r = (await api.get(`/api/surveys/${id}/bookings`).set(auth).expect(200)).body.data;
    expect(r).toMatchObject({ timeZone: 'UTC', capacity: 3 });
    expect(r.bookings.map((x: any) => x.code)).toEqual(['P-01', 'P-02']);
    expect(r.bookings[0].country).toBe('Nigeria');
    expect(JSON.stringify(r)).not.toMatch(/@example\.com/);
    expect(r.open.length).toBe(6);
    const live = (await api.get(`/api/surveys/${id}/live`).set(auth).expect(200)).body.data;
    expect(live).toMatchObject({ places: 3, bookings: { booked: 2, happened: 0, noshow: 0 } });

    // Once all 3 are booked, no times are offered.
    const z = await participant();
    await join(z, id).expect(200);
    await api.post(`/api/surveys/${id}/start-link`).set(z).send({ consent: true }).expect(200);
    await api.post(`/api/surveys/${id}/book`).set(z).send({ start: slots.slots[3].start }).expect(201);
    expect((await api.get(`/api/surveys/${id}/slots`).set(q).expect(200)).body.data.slots).toEqual([]);
  });

  it('cancel up to 12 hours before; not after', async () => {
    const [b] = await BookingModel.find({ surveyId: id, status: 'booked' }).sort({ start: -1 });
    const owner = await ParticipantModel.findById(b.participantId);
    const auth2 = { Authorization: `Bearer ${signAccessToken({ id: String(owner!._id), userType: 'participant' } as any)}` };
    await api.post(`/api/bookings/${b.id}/cancel`).set(auth2).expect(200);
    expect((await api.get(`/api/surveys/${id}/slots`).set(auth2).expect(200)).body.data.slots.length).toBeGreaterThan(0);
    const [soon] = await BookingModel.find({ surveyId: id, status: 'booked' }).sort({ start: 1 });
    await BookingModel.updateOne({ _id: soon._id }, { $set: { start: new Date(Date.now() + 6 * 3600e3), end: new Date(Date.now() + 6.5 * 3600e3) } });
    const owner2 = { Authorization: `Bearer ${signAccessToken({ id: String(soon.participantId), userType: 'participant' } as any)}` };
    expect((await api.post(`/api/bookings/${soon.id}/cancel`).set(owner2).expect(409)).body.code).toBe('too_late');
  });

  it('“happened” pays the participant; “didn’t join” doesn’t, and closes the study to them', async () => {
    const list = await BookingModel.find({ surveyId: id, status: 'booked' }).sort({ start: 1 });
    expect((await api.post(`/api/bookings/${list[1].id}/happened`).set(auth).expect(409)).body.code).toBe('not_yet');
    await BookingModel.updateMany({ _id: { $in: list.map((b) => b._id) } }, { $set: { start: new Date(Date.now() - 3600e3), end: new Date(Date.now() - 1800e3) } });
    await api.post(`/api/bookings/${list[0].id}/happened`).set(auth).expect(200);
    const a: any = await SurveyActionModel.findById(list[0].surveyActionId);
    expect(a.status).toBe('approved');
    expect(await TransactionModel.countDocuments({ surveyId: id, kind: 'charge', status: 'paid' })).toBe(1);

    await api.post(`/api/bookings/${list[1].id}/noshow`).set(auth).expect(200);
    expect((await SurveyActionModel.findById(list[1].surveyActionId))!.status).toBe('no-show');
    const missed = { Authorization: `Bearer ${signAccessToken({ id: String(list[1].participantId), userType: 'participant' } as any)}` };
    expect((await join(missed, id).expect(403)).body.code).toBe('no_show');
    // A mistake can be corrected: they did join after all.
    await api.post(`/api/bookings/${list[1].id}/happened`).set(auth).expect(200);
    expect((await SurveyActionModel.findById(list[1].surveyActionId))!.status).toBe('approved');

    const live = (await api.get(`/api/surveys/${id}/live`).set(auth).expect(200)).body.data;
    expect(live.counts.approved).toBe(2);
    expect(live.bookings).toMatchObject({ happened: 2, noshow: 0 });
    expect(live.money.paidOut).toBeGreaterThan(0);
    expect(live.stuck).toEqual([]); // interviews are never "stuck"
  });

  it('more weekly times or a later end date, without paying (the count stays the same)', async () => {
    const before = (await api.get(`/api/surveys/${id}/bookings`).set(auth).expect(200)).body.data.open.length;
    await api.post(`/api/surveys/${id}/live/add-times`).set(auth).send({ weekly: ['Mon 25:00'] }).expect(400);
    expect((await api.post(`/api/surveys/${id}/live/add-times`).set(auth).send({ to: day(1) }).expect(400)).body.message).toMatch(/or later/);
    await api.post(`/api/surveys/${id}/live/add-times`).set(auth).send({ weekly: ['Mon 15:00', 'Tue 15:00', 'Wed 15:00', 'Thu 15:00', 'Fri 15:00', 'Sat 15:00', 'Sun 15:00'], to: day(12) }).expect(200);
    const setup = (await SurveyModel.findById(id))!.get('plan').setup;
    expect(setup).toMatchObject({ to: day(12), count: 3 });
    expect(setup.weekly).toHaveLength(14);
    expect((await api.get(`/api/surveys/${id}/bookings`).set(auth).expect(200)).body.data.open.length).toBeGreaterThan(before);
  });

  it('a new link for one booking is emailed to the participant', async () => {
    const [b] = await BookingModel.find({ surveyId: id }).limit(1);
    expect((await api.post(`/api/bookings/${b.id}/link`).set(auth).send({ url: 'not a link' }).expect(400)).body.message).toMatch(/full link/);
    await api.post(`/api/bookings/${b.id}/link`).set(auth).send({ url: 'https://ufl.zoom.us/j/999' }).expect(200);
    const p: any = await ParticipantModel.findById(b.participantId);
    expect(lastMail(p.email, /Your meeting link/)!.text).toMatch(/zoom\.us\/j\/999/);
  });

  it('two missed bookings in 30 days pause bookings for that person', async () => {
    const p = await participant();
    for (const ago of [2, 5]) {
      await BookingModel.create({ surveyId: new mongoose.Types.ObjectId(), researcherId: new mongoose.Types.ObjectId(), participantId: p.id, surveyActionId: new mongoose.Types.ObjectId(), start: new Date(Date.now() - ago * 864e5), end: new Date(Date.now() - ago * 864e5 + 1800e3), status: 'noshow', participantTz: 'UTC' });
    }
    await join(p, id).expect(200);
    await api.post(`/api/surveys/${id}/start-link`).set(p).send({ consent: true }).expect(200);
    const slots = (await api.get(`/api/surveys/${id}/slots`).set(p).expect(200)).body.data.slots;
    expect((await api.post(`/api/surveys/${id}/book`).set(p).send({ start: slots[0].start }).expect(403)).body.code).toBe('too_many_no_shows');
  });

  it('reminders go out a day before and an hour before, once each', async () => {
    const p = await participant();
    const s: any = await SurveyModel.findById(id);
    const base = { surveyId: s._id, researcherId: s.userId, participantId: p.id, surveyActionId: new mongoose.Types.ObjectId(), participantTz: 'Africa/Lagos' };
    await BookingModel.create({ ...base, start: new Date(Date.now() + 20 * 3600e3), end: new Date(Date.now() + 20.5 * 3600e3) });
    await BookingModel.create({ ...base, start: new Date(Date.now() + 40 * 60e3), end: new Date(Date.now() + 70 * 60e3) });
    expect(await sendDueReminders()).toBe(2);
    expect(await sendDueReminders()).toBe(0);
    expect(outbox.filter((m) => m.to === p.email && /^Reminder: Teachers and AI/.test(m.subject)).map((m) => m.subject).sort()).toEqual(['Reminder: Teachers and AI in an hour', 'Reminder: Teachers and AI tomorrow']);
    expect(lastMail(p.email, /in an hour/)!.text).toMatch(/zoom\.us\/j\/1/);
    expect(lastMail('tunde6@ufl.edu', /starts in an hour/)).toBeTruthy();
  });

  it('closing early cancels future bookings and tells the participant', async () => {
    // All 3 interviews are taken by now; add 2 more (paid), which opens times again.
    const r = await api.post(`/api/surveys/${id}/live/add-places`).set(auth).send({ extra: 2, method: 'card' }).expect(201);
    expect(r.body.data.amount).toBe(11800); // 2 × 5,000 + 18%
    await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(auth).expect(200);
    expect((await SurveyModel.findById(id))!.get('plan').setup.count).toBe(5);
    const p = await participant();
    await join(p, id).expect(200);
    await api.post(`/api/surveys/${id}/start-link`).set(p).send({ consent: true }).expect(200);
    const slots = (await api.get(`/api/surveys/${id}/slots`).set(p).expect(200)).body.data.slots;
    const b = (await api.post(`/api/surveys/${id}/book`).set(p).send({ start: slots[0].start }).expect(201)).body.data;
    await api.post(`/api/surveys/${id}/live/close`).set(auth).expect(200);
    expect((await BookingModel.findById(b.bookingId))!.status).toBe('cancelled');
    expect(lastMail(p.email, /booking was cancelled/)).toBeTruthy();
  });
});

describe('focus groups', () => {
  let auth: Auth;
  let id: string;
  const at = (d: number) => `${day(d)}T14:00:00.000Z`;

  beforeAll(async () => {
    auth = await researcher('bisi6@ufl.edu');
    id = await liveStudy(auth, 'focus-group', {
      setup: { perGroup: 2, extras: 0, minutes: 60, videoUrl: 'https://meet.example/abc', timeZone: 'UTC', sessions: [at(3), at(4)] },
      pay: { perPerson: 4000 },
    });
  });

  it('each session holds the group size plus extras', async () => {
    const people = [await participant(), await participant(), await participant()];
    for (const p of people) {
      await join(p, id).expect(200);
      await api.post(`/api/surveys/${id}/start-link`).set(p).send({}).expect(200);
    }
    expect((await api.get(`/api/surveys/${id}/slots`).set(people[0]).expect(200)).body.data.slots).toEqual([
      { start: at(3), end: `${day(3)}T15:00:00.000Z`, left: 2 },
      { start: at(4), end: `${day(4)}T15:00:00.000Z`, left: 2 },
    ]);
    await api.post(`/api/surveys/${id}/book`).set(people[0]).send({ start: at(3) }).expect(201);
    await api.post(`/api/surveys/${id}/book`).set(people[1]).send({ start: at(3) }).expect(201);
    expect((await api.post(`/api/surveys/${id}/book`).set(people[2]).send({ start: at(3) }).expect(409)).body.code).toBe('slot_taken');
    const slots = (await api.get(`/api/surveys/${id}/slots`).set(people[2]).expect(200)).body.data.slots;
    expect(slots.map((s: any) => s.start)).toEqual([at(4)]);
    const r = (await api.get(`/api/surveys/${id}/bookings`).set(auth).expect(200)).body.data;
    expect(r).toMatchObject({ capacity: 4 });
  });

  it('more places means another session, paid for the group size', async () => {
    expect((await api.post(`/api/surveys/${id}/live/add-places`).set(auth).send({ extra: 2 }).expect(400)).body.code).toBe('add_session');
    await api.post(`/api/surveys/${id}/live/add-places`).set(auth).send({ session: at(3) }).expect(409);
    const r = await api.post(`/api/surveys/${id}/live/add-places`).set(auth).send({ session: at(6), method: 'card' }).expect(201);
    expect(r.body.data).toMatchObject({ extra: 2, amount: 9440 }); // 2 × 4,000 + 18%
    await api.post(`/api/billing/test-confirm/${r.body.data.fundingId}`).set(auth).expect(200);
    const v = (await api.get(`/api/surveys/${id}/live`).set(auth).expect(200)).body.data;
    expect(v.places).toBe(6);
    expect((await api.get(`/api/surveys/${id}/bookings`).set(auth).expect(200)).body.data.open.map((x: any) => x.start)).toEqual([at(4), at(6)]);
    expect(lastMail('ada6@ufl.edu', /^Receipt/)!.text).toMatch(/2 extra places are open now/);
  });

  it('messages are stored per study and per participant', async () => {
    expect(await MessageModel.countDocuments({ surveyId: id })).toBe(0);
  });
});
