import { Schema, model } from 'mongoose';

/**
 * Sign-ups from the public site: the waitlist, founding-lab applications, "request a country" and AI-evaluation pilots.
 * Replaces the old waitlist model (same `email` + `status` fields, plus the type and form answers).
 */
const leadSchema = new Schema(
  {
    type: { type: String, enum: ['waitlist', 'founding-lab', 'request-country', 'ai-pilot'], required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, trim: true },
    organization: { type: String, trim: true },
    role: { type: String, trim: true },
    country: { type: String, trim: true },
    message: { type: String, trim: true },
    details: { type: Schema.Types.Mixed },
    source: { type: String, trim: true },
    status: { type: String, enum: ['waiting', 'contacted', 'invited', 'joined', 'closed'], default: 'waiting' },
  },
  { timestamps: true }
);
leadSchema.index({ type: 1, email: 1 }, { unique: true });

export const LeadModel = model('Lead', leadSchema);
