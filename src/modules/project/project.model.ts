import { Schema, model } from "mongoose";

export interface IProject extends Document {
  userId: Schema.Types.ObjectId;
  title: string;
  participantView: string;
}

const projectSchema = new Schema<IProject>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    participantView: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

export const ProjectModel = model("Project", projectSchema);
