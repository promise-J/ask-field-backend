import { Schema, model } from "mongoose";

export interface IProject extends Document {
  userId: Schema.Types.ObjectId;
  title: string;
  participantView: string;
  pinned?: boolean;
  pinnedAt?: Date;
}

const projectSchema = new Schema<IProject>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    participantView: { type: String, required: true, trim: true },
    pinned: { type: Boolean, default: false },
    pinnedAt: { type: Date },
  },
  { timestamps: true }
);

export const ProjectModel = model("Project", projectSchema);
