import { isValidObjectId } from 'mongoose';
import AppError from '../../error-helpers/appError';
import { config, env } from '../../config/env';
import { SurveyActionModel, SurveyModel } from './survey.model';
import { ParticipantModel } from '../user/models/participant.model';
import { ResearcherModel } from '../user/models/researcher.model';
import { feeRateFor } from '../user/services/setup.service';
import {
  hourly,
  messageFor,
  legacyFields,
  missingByStep,
  newReturnCode,
  placesAndMinutes,
  profileMatches,
  stepSchema,
  STEPS,
  type Method,
  type Step,
} from './plan';

const round = (n: number) => Math.round(n * 100) / 100;
const methodOf = (s: any): Method => s.method || (s.surveyType === 'aiTaskBuilder' ? 'ai-evaluation' : 'survey');
const needsReturnLink = (m: Method) => m === 'survey' || m === 'product-test' || m === 'ai-evaluation';

async function owned(userId: string, id: string) {
  if (!isValidObjectId(id)) throw new AppError('Study not found.', 404);
  const s = await SurveyModel.findOne({ _id: id, userId });
  if (!s) throw new AppError('Study not found.', 404);
  return s;
}

/** Gives the study a return-link code the first time it needs one. */
async function ensureReturnCode(s: any) {
  if (s.returnCode) return s.returnCode;
  for (let i = 0; i < 5; i++) {
    const code = newReturnCode();
    if (!(await SurveyModel.exists({ returnCode: code }))) {
      s.returnCode = code;
      await s.save();
      return code;
    }
  }
  throw new AppError('Could not make a return link. Try again.', 500);
}

export const returnLinkFor = (code: string) => `${env.FRONTEND_URL.replace(/\/$/, '')}/done/${code}`;

/** Everything the planner shows: the plan, what's missing per step, and the money, at this researcher's fee. */
export async function planView(userId: string, id: string) {
  const s: any = await owned(userId, id);
  const method = methodOf(s);
  if (needsReturnLink(method)) await ensureReturnCode(s);
  const plan = s.plan || {};
  const missing = missingByStep(method, plan);
  const { places, minutes } = placesAndMinutes(method, plan);
  const perPerson = Number(plan.pay?.perPerson) || 0;
  const feeRate = await feeRateFor(userId);
  const pay = round(perPerson * places);
  const fee = round(pay * feeRate);
  const me: any = await ResearcherModel.findById(userId).select('organizationName institutionVerification');
  return {
    surveyId: String(s._id),
    projectId: String(s.projectId),
    method,
    status: s.status === 'published' ? 'live' : s.status,
    launchStage: s.launchStage || 'none',
    name: s.surveyName,
    plan,
    missing,
    done: Object.fromEntries(STEPS.map((k) => [k, missing[k].length === 0])) as Record<Step, boolean>,
    ready: STEPS.every((k) => missing[k].length === 0),
    returnLink: s.returnCode ? returnLinkFor(s.returnCode) : null,
    figures: { places, minutes, perPerson, hourly: hourly(perPerson, minutes), feeRate, pay, fee, total: round(pay + fee), currency: s.currency || env.DEFAULT_CURRENCY },
    minHourlyPay: config.minHourlyPay,
    organization: { name: me?.organizationName || '', verified: me?.institutionVerification?.status === 'verified' },
  };
}

/**
 * Saves one step. Autosave keeps every field that's valid on its own, so nothing typed is lost.
 * With `final`, the whole step must be complete: a 400 `step_incomplete` lists the fields to fix (what was valid is still saved).
 */
export async function saveStep(userId: string, id: string, step: Step, data: Record<string, unknown>, final = false) {
  if (!STEPS.includes(step)) throw new AppError('Unknown step.', 404);
  const s: any = await owned(userId, id);
  if (s.status !== 'draft') throw new AppError('Live studies can’t be changed. Close it and start a new one instead.', 409, 'not_draft');
  if (s.launchStage === 'checking') throw new AppError('We’re checking this study, so it can’t be changed right now.', 409, 'in_review');
  if (s.launchStage === 'awaiting-payment') throw new AppError('Cancel the invoice first if you want to change the plan.', 409, 'awaiting_payment');
  const method = methodOf(s);
  const schema: any = stepSchema(step, method);
  const shape = schema.shape as Record<string, any>;
  const kept: Record<string, unknown> = {};
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (!shape[k]) continue;
    const r = shape[k].safeParse(v);
    if (r.success) kept[k] = r.data;
    else fields[k] = r.error.issues[0] ? messageFor({ ...(r.error.issues[0] as any), path: [k, ...r.error.issues[0].path] }) : 'Check this.';
  }
  const merged = { ...(s.plan?.[step] || {}), ...kept };
  if (step === 'setup') merged.method = method; // a method change would invalidate setup
  s.plan = { ...(s.plan || {}), [step]: merged };
  s.set(legacyFields(method, s.plan));
  s.markModified('plan');
  await s.save();

  if (final) {
    const full = schema.safeParse(merged);
    if (!full.success) {
      for (const i of full.error.issues) {
        const key = i.path.join('.') || '_';
        if (!fields[key]) fields[key] = messageFor(i as any);
      }
    }
    if (Object.keys(fields).length) {
      throw new AppError(Object.values(fields)[0], 400, 'step_incomplete', { fields, view: await planView(userId, id) });
    }
  }
  return { view: await planView(userId, id), fields };
}

/**
 * Real count of participants whose profile fits the saved audience (screening questions aside).
 * Only finished profiles count, as only they can take studies.
 */
export async function matchCount(userId: string, id: string) {
  const s: any = await owned(userId, id);
  const audience = s.plan?.audience || { countries: ['Nigeria'] };
  const people = await ParticipantModel.find({ isCompleteProfile: true }).select('profile').limit(100000).lean();
  let count = 0;
  for (const p of people) if (profileMatches(audience, p).ok) count++;
  return { count, total: people.length };
}

/** Participants: the return link at the end of a survey. Marks their attempt as finished. */
export async function surveyByReturnCode(code: string) {
  const s = await SurveyModel.findOne({ returnCode: String(code).toUpperCase() });
  if (!s) throw new AppError('This finish link isn’t right. Check it with the researcher.', 404, 'unknown_code');
  return s;
}

/** Participant-facing details of a planner study: never the qualifying answers or the return code. */
export function participantView(s: any) {
  const plan = s.plan || {};
  const b = plan.basics || {};
  const a = plan.audience || {};
  const st = plan.setup || {};
  return {
    method: methodOf(s),
    consent: b.consent?.mode === 'joinstudy' ? { required: true, text: b.consent.text || '' } : { required: false, text: '' },
    ethics: b.ethics?.body ? `${b.ethics.body}${b.ethics.reference ? `, ${b.ethics.reference}` : ''}` : '',
    warning: b.sensitive ? b.warning || '' : '',
    hasQuestions: (a.questions || []).length > 0,
    devices: st.devices || [],
    tasks: s.method === 'product-test' ? st.tasks || [] : [],
    books: ['interview', 'focus-group'].includes(methodOf(s)), // Stage 6: choose a time instead of opening a link
  };
}

export async function recordConsentAndStartLink(participantId: string, surveyId: string, consent: boolean) {
  if (!isValidObjectId(surveyId)) throw new AppError('Study not found.', 404);
  const [s, action]: any[] = await Promise.all([
    SurveyModel.findOne({ _id: surveyId, status: 'published' }),
    SurveyActionModel.findOne({ surveyId, participantId }),
  ]);
  if (!s) throw new AppError('This study is no longer taking participants.', 403);
  if (!action || action.status !== 'in-progress') throw new AppError('Check you can take part first.', 409, 'not_started');
  const view = participantView(s);
  if (view.consent.required && !consent) throw new AppError('Please read and agree to the consent information first.', 400, 'consent_required');
  if (view.consent.required && !action.get('consentedAt')) {
    action.set('consentedAt', new Date());
    await action.save();
  }
  // Interviews and focus groups: the next step is choosing a time on joinStudy.
  if (view.books) return { url: `${env.FRONTEND_URL.replace(/\/$/, '')}/dashboard/participant/studies/${surveyId}/book`, surveyActionId: String(action._id), book: true };
  const url = new URL(s.surveyURL);
  if (s.plan?.setup?.passParticipantId !== false) url.searchParams.set('jsid', String(action._id));
  return { url: url.toString(), surveyActionId: String(action._id) };
}
