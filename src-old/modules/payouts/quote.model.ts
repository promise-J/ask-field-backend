import { Schema, Types, model } from 'mongoose';

/** Participant Stage 6 (canvas 6.3): the exact local amount and rate shown before confirming, held for 10 minutes. */
const quoteSchema = new Schema(
  {
    participantId: { type: Types.ObjectId, ref: 'Participant', required: true, index: true },
    amount: { type: Number, required: true }, // in the balance currency (USD)
    currency: { type: String, required: true },
    rate: { type: Number, required: true },
    localAmount: { type: Number, required: true },
    localCurrency: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
  },
  { timestamps: true }
);

export const PayoutQuoteModel = model('PayoutQuote', quoteSchema);

/**
 * Held while one cash-out is being reserved. Its _id is the participant, so a second one at the same moment fails
 * on the unique key: the database itself refuses it, whatever else is running.
 */
const lockSchema = new Schema({ _id: { type: Types.ObjectId, required: true }, at: { type: Date, required: true } });
export const PayoutLockModel = model('PayoutLock', lockSchema);
