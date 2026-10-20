import { Schema, model, InferSchemaType } from 'mongoose';
import { accountFields, hideSecrets } from './account.fields';

const researcherSchema = new Schema(
  {
    ...accountFields,
    userType: { type: String, default: 'researcher', immutable: true },
    jobTitle: { type: String, trim: true },
    organizationType: { type: String, trim: true },
    organizationName: { type: String, trim: true },
    companyName: { type: String, trim: true },
    country: { type: String, trim: true },
    receivesUpdates: { type: Boolean, default: false },
    // What brought them in: the method card they clicked on the homepage, and which button.
    signupIntent: { method: String, source: String },
    // Stage 2 setup ("Tell us about your work")
    role: { type: String, trim: true },
    researchAreas: { type: [String], default: undefined },
    firstMethod: { type: String, trim: true },
    heardFrom: { type: String, trim: true },
    profileCompletedAt: { type: Date },
    // Founding-lab offer on the dashboard (Stage 3): applied once, or hidden with "Not now".
    foundingLab: {
      status: { type: String, enum: ['none', 'applied', 'dismissed'], default: 'none' },
      at: { type: Date },
    },
    // Stage 2.2: proof the researcher works where they say. Gives the badge and the academic fee.
    institutionVerification: {
      status: { type: String, enum: ['none', 'pending', 'verified', 'rejected'], default: 'none' },
      method: { type: String, enum: ['sign-in-email', 'work-email', 'link'] },
      email: { type: String, lowercase: true, trim: true },
      url: { type: String, trim: true },
      requestedAt: Date,
      verifiedAt: Date,
      note: String,
    },
    // Stage 9: account settings
    emailPrefs: {
      bookings: { type: Boolean, default: true },
      messages: { type: Boolean, default: true },
      review: { type: Boolean, default: true },
      finish: { type: Boolean, default: true },
      news: { type: Boolean, default: false },
    },
    pendingEmail: { type: String, lowercase: true, trim: true },
    emailChangeToken: { type: String, select: false },
    emailChangeExpires: { type: Date, select: false },
    passwordChangedAt: Date,
    closedAt: Date,
    // Stage 9: the workspace's receipt details, filled in whenever anyone in it pays.
    billingDetails: { name: String, organization: String, email: String, cc: String, reference: String, country: String },
    institutionCode: { type: String, select: false },
    institutionCodeExpires: { type: Date, select: false },
    institutionCodeAttempts: { type: Number, default: 0, select: false },
    institutionCodeSentAt: { type: Date, select: false },
    // Older onboarding answers (kept so existing accounts don't lose data)
    purposeHere: { type: [String], default: undefined },
    researchType: { type: [String], default: undefined },
    researchInterest: { type: [String], default: undefined },
    address: { street: String, address2: String, city: String, country: String },
  },
  { timestamps: true }
);

hideSecrets(researcherSchema);

export type Researcher = InferSchemaType<typeof researcherSchema>;
export const ResearcherModel = model('Researcher', researcherSchema);
