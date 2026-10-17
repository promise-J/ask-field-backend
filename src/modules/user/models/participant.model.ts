import { Schema, model, InferSchemaType } from 'mongoose';
import { accountFields, hideSecrets } from './account.fields';

/** Answers from the "complete your profile" questionnaire. Field names match the frontend's PARTICIPANT_QUESTIONS. */
const profileSchema = new Schema(
  {
    countryOfResidence: String,
    countryOfBirth: String,
    dob_day: String,
    dob_month: String,
    dob_year: String,
    dateOfBirth: Date,
    gender: String,
    pob: String,
    ethnic: String,
    mostTimeSpent: String,
    firstLanguage: String,
    fluentLanguage: String,
    dialect: String,
    educationLevel: String,
    isStudent: String,
    employmentStatus: String,
    workHour: String,
    mostLifeTime: String,
    shareLinkedin: String,
    currency: String,
    payPerHour: String,
  },
  { _id: false, strict: false }
);

const participantSchema = new Schema(
  {
    ...accountFields,
    userType: { type: String, default: 'participant', immutable: true },
    receivesUpdates: { type: Boolean, default: false },
    profile: { type: profileSchema, default: undefined },
    payoutDetails: {
      method: String,
      bankName: String,
      accountName: String,
      accountNumber: String,
    },
  },
  { timestamps: true }
);

hideSecrets(participantSchema);

export type Participant = InferSchemaType<typeof participantSchema>;
export const ParticipantModel = model('Participant', participantSchema);
