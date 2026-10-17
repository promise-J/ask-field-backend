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
    // Stage 4 planner: { basics, audience, setup, pay }, each saved by its own step. See plan.ts.
    plan: { type: Schema.Types.Mixed, default: () => ({}) },
    // The return link at the end of a survey: https://joinstudy.io/done/<returnCode>
    returnCode: { type: String, unique: true, sparse: true },
    // Stage 5: between "draft" and "published". none → awaiting-payment (invoice) → checking → changes-needed / published, or rejected.
    // Stage 6: paused studies take no new participants; people mid-study can finish.
    paused: { type: Boolean, default: false },
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
    status: { type: String, enum: ['in-progress', 'submitted', 'approved', 'rejected', 'screened-out', 'no-show'], default: 'in-progress', index: true },
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
    finishedBy: { type: String, enum: ['link', 'self', 'booking'] },
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
