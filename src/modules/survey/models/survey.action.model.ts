import { Schema, model } from "mongoose";

export interface ISurveyAction extends Document {
  userId: Schema.Types.ObjectId;
  surveyId: Schema.Types.ObjectId;
  status?: 'draft' | 'published' | 'closed';
}

const surveyActionSchema = new Schema<ISurveyAction>(
  {
    userId: { type: Schema.Types.ObjectId, required: false, trim: true, ref: 'Researcher' },
    surveyId: { type: Schema.Types.ObjectId, required: false, trim: true, ref: 'Survey' },
    status: { type: String, enum: ['draft', 'published', 'closed'], default: 'draft' },
  },
  { timestamps: true }
);

export const SurveyActionModel = model("SurveyAction", surveyActionSchema);
