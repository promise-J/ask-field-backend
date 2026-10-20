import { Schema, model, InferSchemaType } from 'mongoose';
import { accountFields, hideSecrets } from './account.fields';

/**
 * Participant Stage 2: the "About you" profile (canvas 2.1–2.3). Only what matching uses.
 * Field names stay compatible with the matching code in survey/plan.ts.
 * Older profiles may still hold fields we no longer ask for (ethnicity, place of birth…);
 * `npm run trim-participant-profiles` removes them.
 */
const profileSchema = new Schema(
  {
    countryOfResidence: String,
    region: String,
    birthYear: Number,
    birthMonth: Number,
    dateOfBirth: Date, // first day of the birth month: age is all matching needs
    gender: String, // 'female' | 'male'
    firstLanguage: String,
    fluentLanguage: { type: [String], default: undefined },
    educationLevel: String,
    isStudent: String, // 'yes' | 'no'
    employmentStatus: String,
    devices: { type: [String], default: undefined },
    // When each part was last saved (canvas 2.1, 2.2, 2.3).
    parts: { where: Date, languages: Date, work: Date },
  },
  { _id: false, strict: false }
);

/**
 * Participant Stage 1: one-time verification before the first study (canvas 1.7–1.9).
 * joinStudy keeps only results and references. The selfie and face data stay with the selfie
 * provider; the phone number is kept only as a keyed hash (to refuse it on a second account)
 * plus its last two digits for display.
 */
const verificationSchema = new Schema(
  {
    status: { type: String, enum: ['none', 'phone', 'checking', 'verified', 'review', 'duplicate', 'rejected'], default: 'none' },
    consentAt: Date,
    phoneHash: { type: String, select: false },
    phoneLast2: String,
    phoneVerifiedAt: Date,
    channel: { type: String, enum: ['whatsapp', 'sms'] },
    // A code in flight: who sent it (provider reference) and for which number (hashed).
    pending: {
      type: new Schema({ ref: String, phoneHash: String, phoneLast2: String, channel: String, sentAt: Date, attempts: { type: Number, default: 0 } }, { _id: false }),
      select: false,
    },
    sends: { type: [Date], select: false, default: undefined },
    selfieProvider: String,
    selfieSession: { type: String, select: false },
    selfieRef: String,
    selfieAttempts: { type: Number, default: 0 },
    verifiedAt: Date,
    reviewNote: String,
  },
  { _id: false }
);

const participantSchema = new Schema(
  {
    ...accountFields,
    userType: { type: String, default: 'participant', immutable: true },
    receivesUpdates: { type: Boolean, default: false },
    // Participant Stage 3 (canvas 3.4): when we last emailed them about new studies (at most one a day).
    studyAlertAt: Date,
    // Where they live (Stage 1, canvas 1.1): one of PARTICIPANT_COUNTRIES. Older accounts may not have it.
    country: { type: String, trim: true },
    // When they ticked "I'm 18 or older, and I agree to the Participant Terms and Privacy Policy".
    agreedTermsAt: Date,
    verification: { type: verificationSchema, default: () => ({}) },
    // Participant Stage 2: LinkedIn connected (optional). Only LinkedIn's account id, so one LinkedIn
    // can't be used on two accounts, and whether its name matches ours. Not the profile itself.
    linkedin: {
      sub: { type: String, select: false },
      connectedAt: Date,
      nameMatches: Boolean,
    },
    linkedinState: { type: String, select: false },
    profile: { type: profileSchema, default: undefined },
    // Before Participant Stage 6: typed-in details, including full account numbers. No longer written;
    // `npm run strip-payout-numbers` removes the numbers still stored.
    payoutDetails: {
      method: String,
      bankName: String,
      accountName: String,
      accountNumber: String,
    },
    // Participant Stage 6 (canvas 6.2): where cash-outs go. The provider holds the account; we keep its reference,
    // the last digits, the name it reported, and a one-way hash so one account can't be used on two joinStudy accounts.
    payout: {
      method: { type: String, enum: ['bank', 'mobile-money', 'airtime', 'paypal'] },
      institution: String,
      last4: String,
      accountName: String,
      providerRef: String,
      accountHash: String,
      country: String,
      savedAt: Date,
    },
    // Changing the payout method pauses cash-outs until this time (stops account takeovers).
    payoutHoldUntil: Date,
    // Participant Stage 7 (canvas 7.1): settings. Study emails stay in `receivesUpdates` (Stage 3).
    emailPrefs: {
      messages: { type: Boolean, default: true },
      news: { type: Boolean, default: false },
    },
    pendingEmail: { type: String, lowercase: true, trim: true },
    emailChangeToken: { type: String, select: false },
    emailChangeExpires: { type: Date, select: false },
    passwordChangedAt: Date,
    // Refresh and access tokens issued before this stop working ("Sign out everywhere else", password change, closing).
    signedOutAt: Date,
    keepSession: String, // the sign-in that did "Sign out everywhere else" (or changed the password) stays signed in
    closedAt: Date,
  },
  { timestamps: true }
);

participantSchema.index({ 'verification.phoneHash': 1 }, { sparse: true });
participantSchema.index({ 'linkedin.sub': 1 }, { sparse: true });
participantSchema.index({ 'payout.accountHash': 1 }, { unique: true, sparse: true });

hideSecrets(participantSchema);

export type Participant = InferSchemaType<typeof participantSchema>;
export const ParticipantModel = model('Participant', participantSchema);
