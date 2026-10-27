import { Schema, Types, model } from 'mongoose';

/**
 * Participant Stage 3 (canvas 3.3): "Not interested". One row per person per study they hid.
 * Only the participant sees their own rows; researchers get totals per reason, never who.
 */
export const HIDE_REASONS = ['too-long', 'pay-low', 'topic', 'timing', 'other'] as const;
export type HideReason = (typeof HIDE_REASONS)[number];

const studyHideSchema = new Schema(
  {
    participantId: { type: Types.ObjectId, ref: 'Participant', required: true },
    surveyId: { type: Types.ObjectId, ref: 'Survey', required: true, index: true },
    reason: { type: String, enum: HIDE_REASONS },
  },
  { timestamps: true }
);
studyHideSchema.index({ participantId: 1, surveyId: 1 }, { unique: true });

export const StudyHideModel = model('StudyHide', studyHideSchema);
