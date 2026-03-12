import { Schema, model } from 'mongoose';

const researcherSchema = new Schema(
  {
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    firstName: { type: String, required: true },
    verificationToken: { type: String },
    lastName: { type: String, required: true },
  },
  { timestamps: true }
);

export const ResearcherModel = model('Researcher', researcherSchema);
