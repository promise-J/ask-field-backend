import { Schema, model, Types } from 'mongoose';
import { env } from '../../config/env';

const withId = (idKey: string) => ({
  virtuals: false,
  transform: (_doc: unknown, ret: Record<string, any>) => {
    ret[idKey] = String(ret._id);
    for (const k of Object.keys(ret)) if (ret[k] instanceof Types.ObjectId) ret[k] = String(ret[k]);
    delete ret.__v;
    return ret;
  },
});

const surveySchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'Researcher', required: true, index: true },
    projectId: { type: Types.ObjectId, ref: 'Project', required: true, index: true },
    status: { type: String, enum: ['draft', 'published', 'closed'], default: 'draft', index: true },
    surveyType: { type: String, enum: ['external', 'aiTaskBuilder'] },
    // What the researcher said they're running. Stage 4 builds a planner per method; until then every method uses the survey editor.
    method: { type: String, enum: ['survey', 'interview', 'focus-group', 'product-test', 'ai-evaluation'], default: 'survey' },
    surveyName: { type: String, trim: true, required: true },
    internalSurveyName: { type: String, trim: true, default: '' },
    surveyDescription: { type: String, default: '' },
    contentWarning: { type: String, default: '' },
    surveyLabel: { type: String, default: '' },
    usableDevices: { type: [String], default: [] },
    surveyEquipment: { type: String, default: '' },
    minimumAge: Number,
    maximumAge: Number,
    gender: { type: String, default: '' },
    surveyURL: { type: String, trim: true, default: '' },
    toRecordId: { type: String, default: '' },
    handleSubmission: { type: String, default: '' },
    addToParticipantGroup: { type: String, default: '' },
    howToFindParticipant: { type: String, default: '' },
    howToScreenParticipants: { type: String, default: '' },
    screenerIds: { type: [String], default: [] },
    surveyDistribution: { type: String, default: '' },
    // Spelling kept as-is: the frontend sends and reads this name.
    surveyCrendentials: { type: String, default: '' },
    numberOfParticipants: Number,
    totalSubmission: Number,
    inputRejection: Number,
    surveyDuration: Number, // minutes
    surveyAmount: Number, // participant reward per approved submission
    currency: { type: String, default: () => env.DEFAULT_CURRENCY },
    publishedAt: Date,
    closedAt: Date,
    // Stage 8: why it closed, where unused money goes, and what was settled.
    createdBy: { type: Types.ObjectId, ref: 'Researcher' }, // Stage 9: who in the workspace made it; study emails go to them
    closedReason: { type: String, enum: ['early', 'full', 'date'] },
    returnTo: { type: String, enum: ['credit', 'card'], default: 'credit' },
    settlement: Schema.Types.Mixed,
    // Stage 4 planner: { basics, audience, setup, pay }, each saved by its own step. See plan.ts.
    plan: { type: Schema.Types.Mixed, default: () => ({}) },
    // The return link at the end of a survey: https://joinstudy.io/done/<returnCode>
    returnCode: { type: String, unique: true, sparse: true },
    // Stage 5: between "draft" and "published". none → awaiting-payment (invoice) → checking → changes-needed / published, or rejected.
    // Stage 6: paused studies take no new participants; people mid-study can finish.
    paused: { type: Boolean, default: false },
    // Participant Stage 7: paused by joinStudy after reports from several participants. Only joinStudy can lift it.
    reportHold: { at: Date, reports: Number },
    // Participant Stage 4: when we last told the researcher someone left because the link didn't work (once a day at most).
    linkProblemAt: Date,
    launchStage: { type: String, enum: ['none', 'awaiting-payment', 'checking', 'changes-needed', 'rejected'], default: 'none', index: true },
    review: {
      checks: { type: [{ _id: false, key: String, label: String, ok: Boolean, note: String }], default: undefined },
      note: String,
      requestedAt: Date,
      decidedAt: Date,
    },
  },
  { timestamps: true, toJSON: withId('surveyId') }
);

export const SurveyModel = model('Survey', surveySchema);

const surveyActionSchema = new Schema(
  {
    surveyId: { type: Types.ObjectId, ref: 'Survey', required: true, index: true },
    researcherId: { type: Types.ObjectId, ref: 'Researcher', required: true, index: true },
    participantId: { type: Types.ObjectId, ref: 'Participant', required: true, index: true },
    status: { type: String, enum: ['in-progress', 'submitted', 'approved', 'rejected', 'screened-out', 'no-show', 'left', 'timed-out'], default: 'in-progress', index: true },
    // Participant Stage 4: the place is held until this time (link-based studies). Then the status becomes timed-out.
    heldUntil: Date,
    // Participant Stage 4: when they left or their time ran out, and why they left (optional).
    endedAt: Date,
    leftReason: { type: String, enum: ['longer', 'link-broken', 'came-up', 'uncomfortable', 'other', 'account-closed'] },
    // Finished after their time ran out (counted if a place was free; otherwise "over" the places paid for).
    late: { type: String, enum: ['counted', 'over'] },
    // Typing the finish code: wrong tries, and a lock after too many.
    codeTries: { type: Number, default: 0 },
    codeLockedUntil: Date,
    // Participant Stage 5: one question about a "not approved" decision. open → approved | kept → escalated → upheld | overturned.
    appeal: {
      why: { type: String, enum: ['did-tasks', 'did-checks', 'eligible', 'other'] },
      message: String,
      askedAt: Date,
      status: { type: String, enum: ['open', 'approved', 'kept', 'escalated', 'upheld', 'overturned'] },
      answer: String,
      answeredAt: Date,
      escalatedAt: Date,
      resolvedAt: Date,
      resolution: String,
    },
    // Stage 6: how the researcher sees this person, e.g. P-07 (numbered in the order they started).
    code: String,
    screenerAnswers: { type: [Number], default: undefined },
    consentedAt: Date,
    quotaGroup: String,
    startedAt: { type: Date, default: Date.now },
    submittedAt: Date,
    reviewedAt: Date,
    timeSpent: Number, // seconds
    // Stage 7: how they said they'd finished ("link" = the study's finish link), and the decision on their work.
    finishedBy: { type: String, enum: ['link', 'code', 'self', 'booking'] },
    review: {
      by: { type: String, enum: ['researcher', 'auto', 'attendance'] },
      reason: String, // rejections: tasks | attention | low-effort | not-eligible | other
      note: String, // shown to the participant
    },
    reviewReminded: Date,
    amount: Number,
    currency: String,
  },
  { timestamps: true, toJSON: withId('surveyActionId') }
);
surveyActionSchema.index({ surveyId: 1, participantId: 1 }, { unique: true });

export const SurveyActionModel = model('SurveyAction', surveyActionSchema);
