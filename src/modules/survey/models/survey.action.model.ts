import { Schema, model, Document, Types } from "mongoose";

export interface ISurveyAction extends Document {
  surveyId: Types.ObjectId;
  participantId: Types.ObjectId;
  status: "approved" | "awaiting" | "in-progress" | "rejected";
  startedAt: Date;
  submittedAt?: Date;
  timeSpent?: number; // in seconds
}

const surveyActionSchema = new Schema<ISurveyAction>(
  {
    surveyId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Survey",
    },
    participantId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "User", // or "Researcher" depending on your system
    },
    status: {
      type: String,
      enum: ["approved", "awaiting", "in-progress", "rejected"],
      default: "in-progress",
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    submittedAt: {
      type: Date,
    },
    timeSpent: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

export const SurveyActionModel = model("SurveyAction", surveyActionSchema);
