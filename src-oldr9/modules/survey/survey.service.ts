import { assertCanTakeStudies } from '../verification/gate';
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
import { isOpenNow, missingByStep, fitsStudy, profileMatches, quotaGroupOf, screenerPasses, STEPS } from './plan';
import { participantView, surveyByReturnCode } from './plan.service';
import { countTaken, holdMinutes, holdsPlaces } from './holds';

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

/** In progress, but their time ran out (the sweep may not have caught it yet). */
export const isExpired = (a: any, now = new Date()) => a?.status === 'in-progress' && !!a.heldUntil && new Date(a.heldUntil) <= now;

export function outcomeOf(a: any): 'paid' | 'review' | 'late' | 'late-over' {
  if (a.status === 'approved') return 'paid';
  if (a.late === 'over') return 'late-over';
  if (a.late === 'counted') return 'late';
  return 'review';
}

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
  async start(userId: string, input: { method: string; surveyName?: string; projectId?: string; estimate?: { participants: number; minutes: number; ratePerHour: number } }, createdBy?: string) {
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
      createdBy: createdBy || userId,
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
    // Participant Stage 1: one verified person per account before any study (canvas 1.7–1.9).
    const already = await SurveyActionModel.exists({ surveyId, participantId });
    if (!already) assertCanTakeStudies(participant);

    let existing: any = await SurveyActionModel.findOne({ surveyId, participantId });
    // Participant Stage 4: someone who left, or whose time ran out, can start again while there's a place.
    if (existing && (['left', 'timed-out'].includes(existing.status) || isExpired(existing))) existing = null;
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

    if (!existing) await this.assertPlaceFree(survey);

    return existing ?? (await this.startAction(participantId, survey));
  }

  /** Planner studies: profile filters, then the researcher's own questions, then quotas. */
  private async checkPlanned(participantId: string, survey: any, participant: any, existing: any, opts: { answers?: number[] }) {
    if (existing) return existing;
    const audience = survey.plan.audience;
    const fit = fitsStudy(survey.plan, participant);
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
      const now = new Date();
      const taken = await SurveyActionModel.countDocuments({
        surveyId: survey._id,
        quotaGroup: group,
        $or: [{ status: { $in: DONE } }, { status: 'in-progress', $or: [{ heldUntil: { $gt: now } }, { heldUntil: null }] }],
      });
      if (taken >= g.places) throw new AppError('This study already has enough people like you. Keep an eye out for the next one.', 403, 'quota_full');
    }
    await this.assertPlaceFree(survey);
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

  /** Participant Stage 4: places count finishers and people still within their time, so studies can't overfill. */
  private async assertPlaceFree(survey: any) {
    const taken = holdsPlaces(survey) ? await countTaken(survey._id) : await SurveyActionModel.countDocuments({ surveyId: survey._id, status: { $in: DONE } });
    if (taken >= placesFor(survey)) {
      throw new AppError('This study is full right now: all places are taken. If someone leaves or runs out of time, a place opens up again.', 403, 'full');
    }
  }

  private async startAction(participantId: string, survey: any) {
    const now = new Date();
    const minutes = Number(survey.surveyDuration) || Number(survey.plan?.setup?.minutes) || 0;
    const heldUntil = holdsPlaces(survey) ? new Date(now.getTime() + holdMinutes(minutes) * 60000) : undefined;
    try {
      const n = await SurveyActionModel.countDocuments({ surveyId: survey._id });
      return await SurveyActionModel.create({
        surveyId: survey._id,
        researcherId: survey.userId,
        participantId,
        code: `P-${String(n + 1).padStart(2, '0')}`,
        amount: survey.surveyAmount,
        currency: survey.currency,
        startedAt: now,
        heldUntil,
      });
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      const prev: any = await SurveyActionModel.findOne({ surveyId: survey._id, participantId });
      // Starting again after leaving or running out of time: a fresh hold on the same attempt (same P-code).
      if (prev && (['left', 'timed-out'].includes(prev.status) || isExpired(prev))) {
        prev.set({ status: 'in-progress', startedAt: now, heldUntil, endedAt: undefined, leftReason: undefined, codeTries: 0, codeLockedUntil: undefined });
        await prev.save();
      }
      return prev;
    }
  }

  async createAction(participantId: string, surveyId: string) {
    return this.checkEligibility(participantId, surveyId);
  }

  /**
   * Called from /complete-survey after the survey tool redirects back. Accepts a survey id or a survey action id.
   * Marks the attempt submitted and records a pending earning.
   */
  async submit(participantId: string, id: string, finishedBy: 'link' | 'code' | 'self' | 'booking' = 'self') {
    if (!isValidObjectId(id)) throw new AppError('We could not find this study attempt.', 404);
    const action: any =
      (await SurveyActionModel.findOne({ _id: id, participantId })) ??
      (await SurveyActionModel.findOne({ surveyId: id, participantId }));
    if (!action) throw new AppError('We could not find this study attempt. Start the study from your dashboard.', 404, 'not_started');
    const late = action.status === 'timed-out' || action.status === 'left' || isExpired(action);
    if (action.status !== 'in-progress' && !late) return { action, message: 'Your response is already with the researcher for review.', outcome: outcomeOf(action) };
    // A study closed early still accepts people who were mid-way, for 2 hours (Stage 6).
    const study: any = await SurveyModel.findById(action.surveyId).select('status closedAt plan.pay.review plan.setup.minutes surveyDuration returnCode method surveyType numberOfParticipants totalSubmission');
    if (study?.status === 'closed' && (!study.closedAt || Date.now() - new Date(study.closedAt).getTime() > 2 * 3600e3)) {
      throw new AppError('This study has closed, so new responses can’t be counted. Sorry.', 409, 'study_closed');
    }
    // Participant Stage 4: with a finish link, "I've finished" alone isn't enough: come back through the link or type its code.
    if (finishedBy === 'self' && study?.returnCode && holdsPlaces(study)) {
      throw new AppError('Finish through the survey’s last page, or type the finish code it shows.', 409, 'use_code');
    }

    const now = new Date();
    let lateMark: 'counted' | 'over' | undefined;
    if (late) {
      const others = await countTaken(action.surveyId, now, { _id: { $ne: action._id } });
      lateMark = others < placesFor(study) ? 'counted' : 'over';
    }
    action.status = 'submitted';
    action.submittedAt = now;
    action.timeSpent = Math.round((now.getTime() - new Date(action.startedAt).getTime()) / 1000);
    action.set({ finishedBy, late: lateMark, heldUntil: undefined });
    await action.save();
    await ledger.pendingEarning(action);
    // Stage 7: "Approve automatically" pays straight away, unless it was very fast or late (those wait for the researcher).
    const minutes = Number(study?.surveyDuration) || Number(study?.plan?.setup?.minutes) || 0;
    const fast = minutes > 0 && action.timeSpent < (minutes * 60) / 3;
    if (study?.plan?.pay?.review === 'auto' && finishedBy !== 'booking' && !fast && !lateMark) {
      await this.review(String(action.researcherId), String(action._id), 'approved', { by: 'auto' });
      return { action: await SurveyActionModel.findById(action._id), message: 'Done. Your payment is in your balance.', outcome: 'paid' as const };
    }
    if (lateMark === 'over') {
      return { action, message: 'Your answers reached the researcher, but every place had gone by then. They can still choose to pay you.', outcome: 'late-over' as const };
    }
    return {
      action,
      message: lateMark ? 'You finished after your time ran out, but a place was free, so it counts.' : 'Submitted. The researcher will review your response, then your payment moves to your balance.',
      outcome: lateMark ? ('late' as const) : ('review' as const),
    };
  }

  /** Canvas 4.2: typing the finish code from the survey's last page. Five wrong tries lock it for an hour. */
  async finishWithCode(participantId: string, surveyId: string, code: string) {
    if (!isValidObjectId(surveyId)) throw notFound();
    const action: any = await SurveyActionModel.findOne({ surveyId, participantId });
    if (!action) throw new AppError('Start the study first. The code only works for people taking part.', 409, 'not_started');
    if (action.codeLockedUntil && action.codeLockedUntil > new Date()) {
      const mins = Math.ceil((action.codeLockedUntil.getTime() - Date.now()) / 60000);
      throw new AppError(`Too many wrong codes. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or message the researcher.`, 429, 'code_locked');
    }
    const study: any = await SurveyModel.findById(surveyId).select('returnCode');
    const clean = (x: string) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!study?.returnCode || clean(code) !== clean(study.returnCode)) {
      const tries = (action.codeTries || 0) + 1;
      const locked = tries >= 5;
      await SurveyActionModel.updateOne({ _id: action._id }, { $set: { codeTries: locked ? 0 : tries, ...(locked ? { codeLockedUntil: new Date(Date.now() + 3600e3) } : {}) } });
      if (locked) throw new AppError('Too many wrong codes. Try again in an hour, or message the researcher.', 429, 'code_locked');
      const left = 5 - tries;
      throw new AppError(`That isn’t this study’s code. Check the last page of the survey: it’s 6 letters and numbers, like 7KQ2-XM. ${left} ${left === 1 ? 'try' : 'tries'} left.`, 400, 'wrong_code', { triesLeft: left });
    }
    return this.submit(participantId, String(action._id), 'code');
  }

  /** Canvas 4.4: leaving a study frees the place. Never counted against them, never paid. */
  async leave(participantId: string, surveyId: string, reason?: string) {
    if (!isValidObjectId(surveyId)) throw notFound();
    const action: any = await SurveyActionModel.findOne({ surveyId, participantId });
    if (!action || !['in-progress', 'timed-out'].includes(action.status)) throw new AppError('You’re not taking part in this study right now.', 409, 'not_started');
    action.set({ status: 'left', endedAt: new Date(), leftReason: reason || undefined, heldUntil: undefined });
    await action.save();
    return action;
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
