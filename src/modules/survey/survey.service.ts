import { isValidObjectId, Types } from 'mongoose';
import AppError from '../../error-helpers/appError';
import { config } from '../../config/env';
import { ProjectModel } from '../project/project.model';
import { ParticipantModel } from '../user/models/participant.model';
import { ResearcherModel } from '../user/models/researcher.model';

/** Adds who is running each study (name and organisation only), for participant-facing cards. */
async function withResearcher(surveys: any[]) {
  const ids = [...new Set(surveys.map((s) => String(s.userId)))];
  const people = ids.length ? await ResearcherModel.find({ _id: { $in: ids } }).select('firstName lastName organizationName companyName') : [];
  const by = new Map(people.map((r: any) => [String(r._id), { name: `${r.firstName} ${r.lastName}`.trim(), organization: r.organizationName || r.companyName || '' }]));
  return surveys.map((s) => {
    const json: any = s.toJSON();
    const hasPlan = s.plan && Object.keys(s.plan).length > 0;
    delete json.plan;
    delete json.returnCode;
    return { ...json, researcher: by.get(String(s.userId)) ?? null, ...(hasPlan ? { participantView: participantView(s) } : {}) };
  });
}
import { SurveyActionModel, SurveyModel } from './survey.model';
import { ageOn } from '../user/controllers/participant.controller';
import { ledger } from '../wallet/wallet.service';
import { feeRateFor } from '../user/services/setup.service';
import { isOpenNow, missingByStep, profileMatches, quotaGroupOf, screenerPasses, STEPS } from './plan';
import { participantView, surveyByReturnCode } from './plan.service';

const notFound = () => new AppError('Study not found.', 404);
const DONE = ['submitted', 'approved'];

/** Fields the researcher must fill before a study can go live. Mirrors getMissingPublishFields in the frontend. */
const PUBLISH_REQUIRED: [string, string][] = [
  ['surveyType', 'study type'],
  ['surveyName', 'study name'],
  ['surveyDescription', 'study description'],
  ['surveyURL', 'study URL'],
  ['minimumAge', 'minimum age'],
  ['maximumAge', 'maximum age'],
  ['numberOfParticipants', 'number of participants'],
  ['surveyDuration', 'study duration'],
  ['surveyAmount', 'study payment'],
];

/** What's still missing before a draft can launch, in plain words. */
export function missingForPublish(survey: any) {
  return PUBLISH_REQUIRED.filter(([k]) => {
    const v = survey[k];
    return v === undefined || v === null || v === '' || (typeof v === 'number' && v <= 0);
  }).map(([, label]) => label);
}

const METHOD_NAMES: Record<string, string> = {
  survey: 'survey',
  interview: 'interview study',
  'focus-group': 'focus group',
  'product-test': 'product test',
  'ai-evaluation': 'AI evaluation',
};

export function placesFor(survey: any) {
  return Number(survey.numberOfParticipants || survey.totalSubmission || 0);
}

export class SurveyService {
  // ---------- researcher ----------
  async createDraft(userId: string, projectId: string, surveyName: string) {
    const project = await ProjectModel.findOne({ _id: projectId, userId });
    if (!project) throw new AppError('Project not found.', 404);
    return SurveyModel.create({ userId, projectId, surveyName });
  }

  /**
   * Stage 3: starts a draft straight from the dashboard, without asking for a project first.
   * Drafts go into the researcher's "My studies" project, made on first use. Estimate figures, if given, prefill the draft.
   */
  async start(userId: string, input: { method: string; surveyName?: string; projectId?: string; estimate?: { participants: number; minutes: number; ratePerHour: number } }) {
    const chosen = input.projectId ? await ProjectModel.findOne({ _id: input.projectId, userId }) : null;
    if (input.projectId && !chosen) throw new AppError('Project not found.', 404);
    const project =
      chosen ?? (await ProjectModel.findOne({ userId, title: 'My studies' })) ?? (await ProjectModel.create({ userId, title: 'My studies' }));
    const e = input.estimate;
    const name = input.surveyName || `Untitled ${METHOD_NAMES[input.method]}`;
    // Seed the planner with what we already know, so the first steps aren't blank.
    const plan: Record<string, any> = {
      basics: { title: name, consent: { mode: 'joinstudy', text: '' } },
      audience: { countries: ['Nigeria'], minAge: 18, maxAge: 100 },
      setup: { method: input.method },
      pay: {},
    };
    if (e) {
      const perPerson = Math.round(((e.ratePerHour * e.minutes) / 60) * 100) / 100;
      plan.setup.minutes = e.minutes;
      plan.pay.perPerson = perPerson;
      if (input.method === 'interview') plan.setup.count = e.participants;
      else if (input.method !== 'focus-group') plan.pay.places = e.participants;
    }
    return SurveyModel.create({
      plan,
      userId,
      projectId: project._id,
      method: input.method,
      surveyType: input.method === 'ai-evaluation' ? 'aiTaskBuilder' : 'external',
      surveyName: name,
      ...(e && {
        numberOfParticipants: e.participants,
        surveyDuration: e.minutes,
        surveyAmount: Math.round(((e.ratePerHour * e.minutes) / 60) * 100) / 100,
      }),
    });
  }

  async getOwned(userId: string, id: string) {
    if (!isValidObjectId(id)) throw notFound();
    const survey = await SurveyModel.findOne({ _id: id, userId });
    if (!survey) throw notFound();
    return survey;
  }

  async updateDraft(userId: string, id: string, body: Record<string, any>) {
    const survey = await this.getOwned(userId, id);
    if (survey.status !== 'draft') throw new AppError('Live studies can’t be edited. Close it and create a new version instead.', 409);
    if (body.projectId) delete body.projectId; // moving studies between projects isn't supported
    survey.set(body);
    if (survey.minimumAge != null && survey.maximumAge != null && survey.minimumAge > survey.maximumAge) {
      throw new AppError('Minimum age must be lower than maximum age.', 400);
    }
    return survey.save();
  }

  async publish(userId: string, id: string) {
    const survey = await this.getOwned(userId, id);
    if (survey.status === 'published') return survey;
    if (survey.status === 'closed') throw new AppError('This study is closed.', 409);
    const owner = await ResearcherModel.findById(userId).select('isCompleteProfile');
    if (!owner?.isCompleteProfile) {
      throw new AppError('Finish setting up your account before you launch a study.', 403, 'setup_incomplete');
    }
    const plan: any = survey.plan;
    if (plan && Object.keys(plan).length) {
      const method = (survey.method || 'survey') as any;
      const byStep = missingByStep(method, plan);
      const left = STEPS.flatMap((k) => byStep[k]);
      if (left.length) throw new AppError(`Finish your plan first: ${left.join(' ')}`, 400, 'plan_incomplete', { missing: byStep });
      throw new AppError('Pay for your study to launch it. We check it, then it goes live.', 402, 'payment_required');
    } else {
      const missing = missingForPublish(survey);
      if (missing.length) throw new AppError(`Add these before publishing: ${missing.join(', ')}.`, 400);
    }
    survey.status = 'published';
    survey.publishedAt = new Date();
    return survey.save();
  }

  async close(userId: string, id: string) {
    const survey = await this.getOwned(userId, id);
    survey.status = 'closed';
    survey.closedAt = new Date();
    return survey.save();
  }

  listByProject(userId: string, projectId: string, status?: string) {
    if (!isValidObjectId(projectId)) throw new AppError('Project not found.', 404);
    const filter: Record<string, unknown> = { userId, projectId };
    if (status) filter.status = status;
    return SurveyModel.find(filter).sort({ updatedAt: -1 });
  }

  async dashboardStats(userId: string) {
    const counts = await SurveyModel.aggregate([
      { $match: { userId: new Types.ObjectId(userId) } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const by = Object.fromEntries(counts.map((c: any) => [c._id, c.n]));
    const liveSurveys = by.published || 0;
    const draftSurveys = by.draft || 0;
    return {
      activeSurveys: liveSurveys + draftSurveys,
      liveSurveys,
      draftSurveys,
      closedSurveys: by.closed || 0,
      researchSpent: await ledger.researcherSpent(userId),
    };
  }

  // ---------- shared ----------
  async listAll(user: { id: string; userType: string }, status?: string) {
    if (user.userType === 'researcher') {
      const filter: Record<string, unknown> = { userId: user.id };
      if (status) filter.status = status;
      return SurveyModel.find(filter).sort({ updatedAt: -1 });
    }
    // Participants only ever see live studies, minus ones they've already finished and ones that are full.
    const surveys = await SurveyModel.find({ status: 'published' }).select('-internalSurveyName').sort({ publishedAt: -1 }).limit(200);
    const mine = await SurveyActionModel.find({ participantId: user.id, status: { $in: [...DONE, 'rejected'] } }).select('surveyId');
    const finished = new Set(mine.map((a) => String(a.surveyId)));
    const open = surveys.filter((s: any) => !finished.has(String(s._id)) && isOpenNow(s) && !s.paused);
    const filled = await this.filledCounts(open.map((s) => s._id));
    return withResearcher(open.filter((s) => (filled.get(String(s._id)) || 0) < placesFor(s)));
  }

  async getForUser(user: { id: string; userType: string }, id: string) {
    if (user.userType === 'researcher') return this.getOwned(user.id, id);
    if (!isValidObjectId(id)) throw notFound();
    const survey = await SurveyModel.findOne({ _id: id, status: 'published' }).select('-internalSurveyName');
    if (!survey) throw notFound();
    return (await withResearcher([survey]))[0];
  }

  private async filledCounts(ids: Types.ObjectId[]) {
    if (!ids.length) return new Map<string, number>();
    const rows = await SurveyActionModel.aggregate([
      { $match: { surveyId: { $in: ids }, status: { $in: DONE } } },
      { $group: { _id: '$surveyId', n: { $sum: 1 } } },
    ]);
    return new Map<string, number>(rows.map((r: any) => [String(r._id), r.n]));
  }

  // ---------- participant ----------
  /** Checks the participant can take this study. Returns the reason in plain words when they can't. */
  async checkEligibility(participantId: string, surveyId: string, opts: { answers?: number[] } = {}) {
    if (!isValidObjectId(surveyId)) throw notFound();
    const [survey, participant] = await Promise.all([SurveyModel.findById(surveyId), ParticipantModel.findById(participantId)]);
    if (!participant) throw new AppError('Account not found.', 404);
    if (!survey || survey.status !== 'published' || !isOpenNow(survey)) throw new AppError('This study is no longer taking participants.', 403);
    if (!participant.isCompleteProfile) throw new AppError('Complete your profile first so we can match you to studies.', 403);

    const existing = await SurveyActionModel.findOne({ surveyId, participantId });
    if (existing?.status === 'screened-out') throw new AppError('This study is looking for a different group of people. Keep an eye out for the next one.', 403, 'screened_out');
    if (existing?.status === 'no-show') throw new AppError('You missed your booking for this study, so it’s closed to you.', 403, 'no_show');
    if (existing && existing.status !== 'in-progress') throw new AppError('You have already taken part in this study.', 403);
    if (!existing && (survey as any).paused) throw new AppError('This study is paused right now. Try again later.', 403, 'paused');

    const audience: any = (survey as any).plan?.audience;
    if (audience) return this.checkPlanned(participantId, survey, participant, existing, opts);

    const profile: any = participant.profile || {};
    const dob: Date | undefined = profile.dateOfBirth;
    if (survey.minimumAge || survey.maximumAge) {
      if (!dob) throw new AppError('Add your date of birth to your profile to take this study.', 403);
      const age = ageOn(new Date(dob));
      if (survey.minimumAge && age < survey.minimumAge) throw new AppError(`This study is for people aged ${survey.minimumAge}–${survey.maximumAge ?? '+'}.`, 403);
      if (survey.maximumAge && age > survey.maximumAge) throw new AppError(`This study is for people aged ${survey.minimumAge ?? 18}–${survey.maximumAge}.`, 403);
    }
    const wanted = String(survey.gender || '').trim().toLowerCase();
    if (wanted && !['all', 'any', 'everyone', 'both'].includes(wanted)) {
      if (String(profile.gender || '').trim().toLowerCase() !== wanted) {
        throw new AppError("This study is looking for a different group of people. Keep an eye out for the next one.", 403);
      }
    }

    if (!existing) {
      const filled = await SurveyActionModel.countDocuments({ surveyId, status: { $in: DONE } });
      if (filled >= placesFor(survey)) throw new AppError('This study is full.', 403);
    }

    return existing ?? (await this.startAction(participantId, survey));
  }

  /** Planner studies: profile filters, then the researcher's own questions, then quotas. */
  private async checkPlanned(participantId: string, survey: any, participant: any, existing: any, opts: { answers?: number[] }) {
    if (existing) return existing;
    const audience = survey.plan.audience;
    const fit = profileMatches(audience, participant);
    if (!fit.ok) throw new AppError(fit.reason!, 403, 'not_eligible');

    const questions: any[] = audience.questions || [];
    if (questions.length) {
      const answers = opts.answers;
      if (!answers || answers.length !== questions.length) {
        throw new AppError('Answer a few quick questions first.', 409, 'screener_required', {
          questions: questions.map((q) => ({ text: q.text, answers: q.answers.map((x: any) => x.text) })),
        });
      }
      if (!screenerPasses(questions, answers)) {
        await SurveyActionModel.updateOne(
          { surveyId: survey._id, participantId },
          { $setOnInsert: { researcherId: survey.userId, status: 'screened-out', screenerAnswers: answers, amount: 0, currency: survey.currency } },
          { upsert: true }
        );
        throw new AppError('Thanks. This study is looking for a different group of people this time.', 403, 'screened_out');
      }
    }

    const group = quotaGroupOf(audience, participant);
    if (audience.quota) {
      const g = audience.quota.groups.find((x: any) => x.value === group);
      if (!g) throw new AppError('This study is looking for a different group of people. Keep an eye out for the next one.', 403, 'not_eligible');
      const taken = await SurveyActionModel.countDocuments({ surveyId: survey._id, quotaGroup: group, status: { $in: [...DONE, 'in-progress'] } });
      if (taken >= g.places) throw new AppError('This study already has enough people like you. Keep an eye out for the next one.', 403, 'quota_full');
    }
    const filled = await SurveyActionModel.countDocuments({ surveyId: survey._id, status: { $in: DONE } });
    if (filled >= placesFor(survey)) throw new AppError('This study is full.', 403);
    const action = await this.startAction(participantId, survey);
    if (action && (opts.answers || group)) {
      action.set({ screenerAnswers: opts.answers, quotaGroup: group || undefined });
      await action.save();
    }
    return action;
  }

  /** The return link at the end of a survey (joinstudy.io/done/CODE). */
  async submitByCode(participantId: string, code: string) {
    const survey = await surveyByReturnCode(code);
    return this.submit(participantId, String(survey._id), 'link');
  }

  private async startAction(participantId: string, survey: any) {
    try {
      const n = await SurveyActionModel.countDocuments({ surveyId: survey._id });
      return await SurveyActionModel.create({
        surveyId: survey._id,
        researcherId: survey.userId,
        participantId,
        code: `P-${String(n + 1).padStart(2, '0')}`,
        amount: survey.surveyAmount,
        currency: survey.currency,
      });
    } catch (err: any) {
      if (err?.code === 11000) return SurveyActionModel.findOne({ surveyId: survey._id, participantId });
      throw err;
    }
  }

  async createAction(participantId: string, surveyId: string) {
    return this.checkEligibility(participantId, surveyId);
  }

  /**
   * Called from /complete-survey after the survey tool redirects back. Accepts a survey id or a survey action id.
   * Marks the attempt submitted and records a pending earning.
   */
  async submit(participantId: string, id: string, finishedBy: 'link' | 'self' | 'booking' = 'self') {
    if (!isValidObjectId(id)) throw new AppError('We could not find this study attempt.', 404);
    const action =
      (await SurveyActionModel.findOne({ _id: id, participantId })) ??
      (await SurveyActionModel.findOne({ surveyId: id, participantId }));
    if (!action) throw new AppError('We could not find this study attempt. Start the study from your dashboard.', 404);
    if (action.status !== 'in-progress') return { action, message: 'Your response is already with the researcher for review.' };
    // A study closed early still accepts people who were mid-way, for 2 hours (Stage 6).
    const study: any = await SurveyModel.findById(action.surveyId).select('status closedAt plan.pay.review');
    if (study?.status === 'closed' && (!study.closedAt || Date.now() - new Date(study.closedAt).getTime() > 2 * 3600e3)) {
      throw new AppError('This study has closed, so new responses can’t be counted. Sorry.', 409, 'study_closed');
    }

    action.status = 'submitted';
    action.submittedAt = new Date();
    action.timeSpent = Math.round((action.submittedAt.getTime() - new Date(action.startedAt).getTime()) / 1000);
    action.set('finishedBy', finishedBy);
    await action.save();
    await ledger.pendingEarning(action);
    // Stage 7: "Approve automatically" in the plan pays straight away (bookings are approved when marked).
    if (study?.plan?.pay?.review === 'auto' && finishedBy !== 'booking') {
      await this.review(String(action.researcherId), String(action._id), 'approved', { by: 'auto' });
      return { action: await SurveyActionModel.findById(action._id), message: 'Done. Your payment is in your balance.' };
    }
    return { action, message: 'Submitted. The researcher will review your response, then your payment moves to your balance.' };
  }

  // ---------- researcher review ----------
  async listActionsForResearcher(researcherId: string, surveyId?: string) {
    const filter: Record<string, unknown> = { researcherId };
    if (surveyId && isValidObjectId(surveyId)) filter.surveyId = surveyId;
    return SurveyActionModel.find(filter).sort({ submittedAt: -1, createdAt: -1 }).limit(500);
  }

  async getAction(user: { id: string; userType: string }, id: string) {
    if (!isValidObjectId(id)) throw new AppError('Submission not found.', 404);
    const owner = user.userType === 'researcher' ? { researcherId: user.id } : { participantId: user.id };
    const action = await SurveyActionModel.findOne({ _id: id, ...owner });
    if (!action) throw new AppError('Submission not found.', 404);
    return action;
  }

  async review(researcherId: string, id: string, decision: 'approved' | 'rejected', meta: { by?: 'researcher' | 'auto' | 'attendance'; reason?: string; note?: string; why?: string } = {}) {
    const action = await this.getAction({ id: researcherId, userType: 'researcher' }, id);
    if (action.status === decision) return action;
    if (action.status !== 'submitted') {
      throw new AppError(action.status === 'in-progress' ? 'The participant hasn’t submitted yet.' : `This submission was already ${action.status}.`, 409);
    }
    action.status = decision;
    action.reviewedAt = new Date();
    action.set('review', { by: meta.by || 'researcher', reason: meta.reason, note: meta.note });
    await action.save();
    if (decision === 'approved') await ledger.approve(action, await feeRateFor(researcherId));
    else await ledger.reject(action, meta.why);
    return action;
  }
}
