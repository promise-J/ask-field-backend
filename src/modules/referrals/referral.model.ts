import { Schema, model, Types } from 'mongoose';

/**
 * Refer a friend: one row per invited person, made when they sign up with someone's link.
 * Researchers invite researchers, participants invite participants.
 *
 * status
 * - joined: signed up with the link
 * - qualified: a researcher friend paid for a study / a participant friend finished verification
 * - blocked: looks like the same person or organisation (see referral.service `abuseReason`); no rewards
 */
const referralSchema = new Schema(
  {
    type: { type: String, enum: ['researcher', 'participant'], required: true },
    referrerId: { type: Types.ObjectId, required: true, index: true },
    friendId: { type: Types.ObjectId, required: true, unique: true },
    code: { type: String, required: true },
    status: { type: String, enum: ['joined', 'qualified', 'blocked'], default: 'joined', index: true },
    blockedReason: String,
    qualifiedAt: Date,
    // Researchers: fees counted from the friend's sign-up until this time.
    windowEnds: Date,
    // Researchers: credit granted so far for this friend.
    earned: { type: Number, default: 0 },
    // Participants: when the cash reward (PARTICIPANT_REFERRAL_REWARD) was paid.
    rewardPaidAt: Date,
    // Nothing more can happen for this friend: the sweep skips it.
    settled: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

export const ReferralModel = model('Referral', referralSchema);
