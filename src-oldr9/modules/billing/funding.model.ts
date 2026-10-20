import { Schema, model, Types } from 'mongoose';

/**
 * Stage 5: money paid in for one study (by card or invoice). A study can have more than one
 * (a top-up when changes raise the cost). Participants are paid from it as work is approved.
 */
const fundingSchema = new Schema(
  {
    surveyId: { type: Types.ObjectId, ref: 'Survey', required: true, index: true },
    researcherId: { type: Types.ObjectId, ref: 'Researcher', required: true, index: true },
    method: { type: String, enum: ['card', 'invoice', 'credit'], required: true },
    // launch = the study's first payment (or a top-up before launch); add-places = more places on a live study (Stage 6).
    purpose: { type: String, enum: ['launch', 'add-places'], default: 'launch' },
    extraPlaces: Number,
    extraSession: String,
    refunded: { type: Number, default: 0 },
    paidBy: { type: Types.ObjectId, ref: 'Researcher' }, // Stage 9: who in the workspace paid // Stage 8: unused money sent back to this card // focus groups: the new session these places are for (ISO time)
    status: { type: String, enum: ['pending', 'paid', 'cancelled', 'refunded'], default: 'pending', index: true },
    amount: { type: Number, required: true, min: 0 }, // what is (or was) due from the researcher
    creditUsed: { type: Number, default: 0 },
    currency: { type: String, required: true },
    breakdown: { places: Number, perPerson: Number, pay: Number, feeRate: Number, fee: Number, total: Number },
    receipt: { name: String, organization: String, email: String, cc: String, reference: String, country: String },
    provider: { type: String, enum: ['stripe', 'test', 'bank'] },
    providerRef: { type: String, index: true },
    number: { type: String, unique: true, sparse: true }, // JS-2026-0001: invoice and receipt number
    paidAt: Date,
    cardLast4: String,
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_d: unknown, ret: Record<string, any>) => {
        ret.fundingId = String(ret._id);
        for (const k of ['_id', 'surveyId', 'researcherId']) if (ret[k]) ret[k] = String(ret[k]);
        delete ret.__v;
        return ret;
      },
    },
  }
);

export const FundingModel = model('Funding', fundingSchema);
