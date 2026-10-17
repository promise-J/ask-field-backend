import { Schema, model, Types } from 'mongoose';

const projectSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'Researcher', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    participantView: { type: String, trim: true, default: '' },
    pinned: { type: Boolean, default: false },
    pinnedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const ProjectModel = model('Project', projectSchema);
