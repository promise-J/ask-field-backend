import { Schema, model, Types } from 'mongoose';

/**
 * Participant Stage 7.
 *
 * ClosedIdentity: when a participant closes their account we keep one-way codes (keyed hashes) of their phone,
 * and payout account for 12 months, so the same person can't come back as a "new" participant.
 * They can't be turned back into the real details. Checks ignore expired ones, and the server deletes them hourly
 * (a sweep rather than a TTL index, so it also works on the FerretDB used in development).
 */
const closedIdentitySchema = new Schema(
  {
    kind: { type: String, enum: ['phone', 'selfie', 'payout'], required: true },
    hash: { type: String, required: true },
    closedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false }
);
closedIdentitySchema.index({ kind: 1, hash: 1 });
closedIdentitySchema.index({ expiresAt: 1 });
export const sweepClosedIdentities = (now = new Date()) => ClosedIdentityModel.deleteMany({ expiresAt: { $lte: now } });
export const ClosedIdentityModel = model('ClosedIdentity', closedIdentitySchema);

export const HELP_TOPICS = ['account', 'money', 'verification', 'study', 'other'] as const;
export const REPORT_REASONS = ['asks-details', 'asks-money', 'harmful', 'not-as-described', 'broken-link', 'other'] as const;
/** Reasons that count towards pausing a study automatically. */
export const SERIOUS_REASONS = ['asks-details', 'asks-money', 'harmful'];

/**
 * Canvas 7.3 and 7.4: a message to joinStudy from Help ("help"), or a report about a study ("report").
 * Each has a reference the participant can quote (JS-HP-000012, JS-RP-000031).
 */
const supportCaseSchema = new Schema(
  {
    kind: { type: String, enum: ['help', 'report'], required: true, index: true },
    reference: { type: String, required: true, unique: true },
    participantId: { type: Types.ObjectId, ref: 'Participant', required: true, index: true },
    topic: { type: String, enum: HELP_TOPICS },
    surveyId: { type: Types.ObjectId, ref: 'Survey', index: true },
    reason: { type: String, enum: REPORT_REASONS },
    message: { type: String, maxlength: 4000, default: '' },
    status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
    resolution: String,
    resolvedAt: Date,
  },
  { timestamps: true }
);
supportCaseSchema.index({ kind: 1, surveyId: 1, participantId: 1 });
export const SupportCaseModel = model('SupportCase', supportCaseSchema);
