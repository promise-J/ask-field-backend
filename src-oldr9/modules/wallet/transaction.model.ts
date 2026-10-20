import { Schema, model, Types } from 'mongoose';

/**
 * One ledger line. Participants have `earning` and `payout` lines; researchers have `charge` lines
 * (the participant reward plus the platform fee, recorded when a submission is approved).
 */
const transactionSchema = new Schema(
  {
    ownerId: { type: Types.ObjectId, required: true, index: true },
    ownerType: { type: String, enum: ['participant', 'researcher'], required: true },
    // forfeit = a ready balance given up when a participant closes their account (Stage 7).
    // funding = money paid in for a study (Stage 5); credit = money returned as credit; credit-used = credit spent on a study.
    kind: { type: String, enum: ['earning', 'payout', 'charge', 'funding', 'credit', 'credit-used', 'refund', 'forfeit'], required: true }, // refund = unused money sent back to a card (Stage 8)
    status: { type: String, enum: ['pending', 'available', 'processing', 'paid', 'cancelled', 'failed', 'refunded'], required: true },
    amount: { type: Number, required: true, min: 0 },
    fee: { type: Number, default: 0 },
    currency: { type: String, required: true },
    surveyId: { type: Types.ObjectId, ref: 'Survey' },
    surveyActionId: { type: Types.ObjectId, ref: 'SurveyAction' },
    // "<surveyActionId>:<kind>" for earnings and charges, so retries can't pay or charge twice.
    ledgerKey: { type: String, unique: true, sparse: true },
    description: String,
    payoutDetails: { method: String, bankName: String, accountName: String, accountNumberLast4: String },
    // Participant Stage 6: a cash-out in the participant's own currency, sent by the payout provider.
    payout: {
      method: String,
      institution: String,
      last4: String,
      accountName: String,
      localAmount: Number,
      localCurrency: String,
      rate: Number,
      reference: String,
      provider: String,
      providerRef: String,
      sentAt: Date,
      failedAt: Date,
      failReason: String,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_d: unknown, ret: Record<string, any>) => {
        for (const k of ['_id', 'ownerId', 'surveyId', 'surveyActionId']) if (ret[k]) ret[k] = String(ret[k]);
        delete ret.__v;
        return ret;
      },
    },
  }
);

export const TransactionModel = model('Transaction', transactionSchema);
