import { Schema, model, Document, Types } from "mongoose";

export interface ISurveyResponse extends Document {
  surveyId: Types.ObjectId;
  participantId: Types.ObjectId;

  status: "live" | "submitted" | "abandoned" | "in-progress";

  answers: {
    field: string;
    value: string | number | boolean | string[];
  }[];

  startedAt: Date;
  submittedAt?: Date;

  timeSpent?: number; // in seconds
}

const surveyResponseSchema = new Schema<ISurveyResponse>(
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
      enum: ["live", "submitted", "abandoned"],
      default: "in-progress",
    },

    answers: [
      {
        field: { type: String, required: true }, // question key / label
        value: { type: Schema.Types.Mixed, required: true },
      },
    ],

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

export const SurveyModel = model("SurveyResponse", surveyResponseSchema);
