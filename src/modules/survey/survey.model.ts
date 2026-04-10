import { Schema, model } from "mongoose";

export interface ISurvey extends Document {
  userId: Schema.Types.ObjectId;
  projectId: Schema.Types.ObjectId;
  surveyType?: string;
  surveyName?: string;
  internalSurveyName?: string;
  surveyDescription?: string;
  surveyLabel?: string;
  usableDevices?: string[];
  surveyEquipment?: string;
  contentWarning?: string;
  surveyURL?: string;
  toRecordId?: string;
  handleSubmission?: string;
  addToParticipantGroup?: string;
  howToFindParticipant?: string;
  numberOfParticipants?: number;
  howToScreenParticipants?: string;
  surveyDistribution?: string;
  surveyCrendentials?: string;
  totalSubmission?: number;
  inputRejection?: number;
  surveyDuration?: number;
  surveyAmount?: number;
  status?: 'draft' | 'published' | 'closed';
}

const surveySchema = new Schema<ISurvey>(
  {
    userId: { type: Schema.Types.ObjectId, required: false, trim: true, ref: 'Researcher' },
    projectId: { type: Schema.Types.ObjectId, required: false, trim: true, ref: 'Project' },
    surveyType: { type: String, required: false, trim: true },
    surveyName: { type: String, required: false, trim: true },
    internalSurveyName: { type: String, trim: true },
    surveyDescription: { type: String, required: false, trim: true },
    surveyLabel: { type: String, required: false, trim: true },
    usableDevices: { type: [String], default: [] },
    surveyEquipment: { type: String, trim: true },
    contentWarning: { type: String, trim: true },
    surveyURL: { type: String, trim: true },
    toRecordId: { type: String, trim: true },
    handleSubmission: { type: String, trim: true },
    addToParticipantGroup: { type: String, trim: true },
    howToFindParticipant: { type: String, trim: true },
    numberOfParticipants: { type: Number, default: 0 },
    howToScreenParticipants: { type: String, trim: true },
    surveyDistribution: { type: String, trim: true },
    surveyCrendentials: { type: String, trim: true },
    totalSubmission: { type: Number, default: 0 },
    inputRejection: { type: Number, default: 0 },
    surveyDuration: { type: Number, default: 0 },
    surveyAmount: { type: Number, default: 0 },
    status: { type: String, enum: ['draft', 'published', 'closed'], default: 'draft' },
  },
  { timestamps: true }
);

export const SurveyModel = model("Survey", surveySchema);
