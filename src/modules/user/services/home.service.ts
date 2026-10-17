import { Types } from 'mongoose';
import AppError from '../../../error-helpers/appError';
import { env } from '../../../config/env';
import { ResearcherModel } from '../models/researcher.model';
import { SurveyActionModel, SurveyModel } from '../../survey/survey.model';
import { missingForPublish, placesFor } from '../../survey/survey.service';
import { TransactionModel } from '../../wallet/transaction.model';
import { LeadModel } from '../../leads/lead.model';
import { sendMail } from '../../../utils/mailer';
import { feeRateFor } from './setup.service';
import { FundingModel } from '../../billing/funding.model';
import { creditBalance } from '../../billing/launch.service';
import { missingByStep, STEPS } from '../../survey/plan';

const STATUS: Record<string, 'draft' | 'live' | 'closed'> = { draft: 'draft', published: 'live', closed: 'closed' };
const round = (n: number) => Math.round(n * 100) / 100;

/** Older studies have no `method`; AI Task Builder ones are AI evaluations, everything else a survey. */
const methodOf = (s: any) => s.method || (s.surveyType === 'aiTaskBuilder' ? 'ai-evaluation' : 'survey');

/**
 * Stage 3: everything the researcher home needs in one call. Only real figures: no trends, no estimates.
 * Studies come from every project, so a study never "disappears" because it sits in a project.
 */
export async function homeSummary(researcherId: string) {
  const me = await ResearcherModel.findById(researcherId);
  if (!me) throw new AppError('Account not found.', 404);
  const owner = new Types.ObjectId(researcherId);

  const surveys = await SurveyModel.find({ userId: owner }).sort({ updatedAt: -1 }).limit(200);
  const ids = surveys.map((s) => s._id);
  const [actionRows, chargeRows, foundingLead, feeRate, fundRows, credit] = await Promise.all([
    ids.length
      ? SurveyActionModel.aggregate([{ $match: { surveyId: { $in: ids } } }, { $group: { _id: { s: '$surveyId', st: '$status' }, n: { $sum: 1 } } }])
      : [],
    TransactionModel.aggregate([
      { $match: { ownerId: owner, ownerType: 'researcher', kind: 'charge', status: 'paid' } },
      { $group: { _id: '$surveyId', total: { $sum: '$amount' } } },
    ]),
    LeadModel.findOne({ type: 'founding-lab', email: me.email }).select('_id'),
    feeRateFor(researcherId),
    ids.length ? FundingModel.find({ surveyId: { $in: ids }, status: 'paid' }).select('surveyId amount creditUsed').lean() : [],
    creditBalance(researcherId),
  ]);
  const fundedBy = new Map<string, number>();
  for (const f of fundRows as any[]) fundedBy.set(String(f.surveyId), round((fundedBy.get(String(f.surveyId)) || 0) + (f.amount || 0) + (f.creditUsed || 0)));

  const counts = new Map<string, Record<string, number>>();
  for (const r of actionRows as any[]) {
    const k = String(r._id.s);
    counts.set(k, { ...(counts.get(k) || {}), [r._id.st]: r.n });
  }
  const spentBy = new Map<string, number>((chargeRows as any[]).map((r) => [String(r._id), round(r.total)]));

  const studies = surveys.map((s: any) => {
    const c = counts.get(String(s._id)) || {};
    const status = STATUS[s.status] || 'draft';
    return {
      surveyId: String(s._id),
      projectId: String(s.projectId),
      name: s.surveyName,
      method: methodOf(s),
      status,
      places: placesFor(s),
      approved: c.approved || 0,
      rejected: c.rejected || 0,
      toReview: c.submitted || 0,
      inProgress: c['in-progress'] || 0,
      spent: spentBy.get(String(s._id)) || 0,
      missing: status !== 'draft' ? [] : s.plan && Object.keys(s.plan).length ? STEPS.flatMap((k) => missingByStep(methodOf(s), s.plan)[k]) : missingForPublish(s),
      // Stage 5: where a draft is in launching (none, awaiting-payment, checking, changes-needed, rejected).
      stage: s.launchStage || 'none',
      funded: fundedBy.get(String(s._id)) || 0,
      updatedAt: s.updatedAt,
    };
  });

  const notes = new Map(surveys.map((s: any) => [String(s._id), s.review?.note || '']));
  const needsYou = [
    ...studies
      .filter((s) => s.stage === 'changes-needed')
      .map((s) => ({ kind: 'changes' as const, surveyId: s.surveyId, projectId: s.projectId, name: s.name, count: 1, note: notes.get(s.surveyId) || '' })),
    ...studies
      .filter((s) => s.status !== 'draft' && s.toReview > 0)
      .sort((a, b) => b.toReview - a.toReview)
      .map((s) => ({ kind: 'review' as const, surveyId: s.surveyId, projectId: s.projectId, name: s.name, count: s.toReview })),
    ...studies
      .filter((s) => s.status === 'draft' && s.stage === 'none')
      .slice(0, 3)
      .map((s) => ({ kind: 'draft' as const, surveyId: s.surveyId, projectId: s.projectId, name: s.name, count: s.missing.length, missing: s.missing })),
  ].slice(0, 6);

  const v: any = me.get('institutionVerification') || {};
  const founding = foundingLead ? 'applied' : me.get('foundingLab.status') || 'none';
  return {
    firstName: me.firstName,
    account: {
      setupComplete: !!me.isCompleteProfile,
      organizationName: me.get('organizationName') || '',
      organizationType: me.get('organizationType') || '',
      firstMethod: me.get('firstMethod') || me.get('signupIntent.method') || '',
      verification: v.status || 'none',
      feeRate,
    },
    counts: {
      total: studies.length,
      draft: studies.filter((s) => s.status === 'draft').length,
      live: studies.filter((s) => s.status === 'live').length,
      closed: studies.filter((s) => s.status === 'closed').length,
    },
    studies,
    needsYou,
    // Money held at launch and refunds arrive with funding in Stage 5. Until then only approved work is charged.
    money: {
      paid: round(studies.reduce((t, s) => t + s.spent, 0)),
      // Paid in for studies that aren't closed, minus what's been paid out of them.
      held: round(studies.filter((s) => s.status !== 'closed').reduce((t, s) => t + Math.max(0, s.funded - s.spent), 0)),
      credit,
      currency: env.DEFAULT_CURRENCY,
    },
    founding,
  };
}

/** The founding-lab card: apply with the details we already have, or hide it ("Not now"). */
export async function foundingLab(researcherId: string, action: 'apply' | 'dismiss') {
  const me = await ResearcherModel.findById(researcherId);
  if (!me) throw new AppError('Account not found.', 404);
  if (action === 'dismiss') {
    if (me.get('foundingLab.status') !== 'applied') me.set('foundingLab', { status: 'dismissed', at: new Date() });
    await me.save();
    return { status: me.get('foundingLab.status') };
  }
  const lead = {
    name: `${me.firstName} ${me.lastName || ''}`.trim(),
    organization: me.get('organizationName') || '',
    role: me.get('role') || '',
    country: me.get('country') || '',
    source: 'dashboard',
    details: {
      organizationType: me.get('organizationType') || '',
      verification: me.get('institutionVerification.status') || 'none',
      firstMethod: me.get('firstMethod') || '',
    },
  };
  const existing = await LeadModel.findOne({ type: 'founding-lab', email: me.email });
  await LeadModel.updateOne({ type: 'founding-lab', email: me.email }, { $set: lead, $setOnInsert: { type: 'founding-lab', email: me.email } }, { upsert: true });
  if (!existing) {
    await sendMail({
      to: env.LEADS_INBOX,
      subject: `New founding-lab request from ${lead.organization || lead.name}`,
      text: JSON.stringify({ type: 'founding-lab', email: me.email, ...lead }, null, 2),
    });
  }
  me.set('foundingLab', { status: 'applied', at: new Date() });
  await me.save();
  return { status: 'applied' as const };
}
