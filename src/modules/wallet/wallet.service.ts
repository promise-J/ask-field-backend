import { Types } from 'mongoose';
import AppError from '../../error-helpers/appError';
import { env, config } from '../../config/env';
import { TransactionModel } from './transaction.model';
import { ParticipantModel } from '../user/models/participant.model';
import { SurveyModel } from '../survey/survey.model';

/** Adds `title` (the study name, or a plain label) to each ledger line for display. */
async function withTitles(rows: any[]) {
  const ids = [...new Set(rows.map((r) => r.surveyId && String(r.surveyId)).filter(Boolean))];
  const surveys = ids.length ? await SurveyModel.find({ _id: { $in: ids } }).select('surveyName') : [];
  const names = new Map(surveys.map((x: any) => [String(x._id), x.surveyName]));
  return rows.map((r) => {
    const json = r.toJSON();
    json.title = names.get(String(r.surveyId)) || (r.kind === 'payout' ? 'Withdrawal' : r.description || 'Study');
    return json;
  });
}

const round = (n: number) => Math.round(n * 100) / 100;

async function sum(match: Record<string, unknown>) {
  const rows = await TransactionModel.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
  return round(rows[0]?.total || 0);
}

/** Money movements triggered by the survey flow. */
export const ledger = {
  async pendingEarning(action: any) {
    if (!action.amount) return;
    await TransactionModel.updateOne(
      { ledgerKey: `${action._id}:earning` },
      {
        $setOnInsert: {
          ownerId: action.participantId,
          ownerType: 'participant',
          kind: 'earning',
          status: 'pending',
          amount: action.amount,
          currency: action.currency || env.DEFAULT_CURRENCY,
          surveyId: action.surveyId,
          surveyActionId: action._id,
          description: 'Study reward (awaiting review)',
        },
      },
      { upsert: true }
    );
  },

  async approve(action: any, feeRate: number) {
    await this.pendingEarning(action); // in case the submission predates the ledger
    await TransactionModel.updateOne(
      { ledgerKey: `${action._id}:earning` },
      { $set: { status: 'available', description: 'Study reward' } }
    );
    if (!action.amount) return;
    const fee = round(action.amount * feeRate);
    await TransactionModel.updateOne(
      { ledgerKey: `${action._id}:charge` },
      {
        $setOnInsert: {
          ownerId: action.researcherId,
          ownerType: 'researcher',
          kind: 'charge',
          status: 'paid',
          amount: round(action.amount + fee),
          fee,
          currency: action.currency || env.DEFAULT_CURRENCY,
          surveyId: action.surveyId,
          surveyActionId: action._id,
          description: 'Approved submission (reward + platform fee)',
        },
      },
      { upsert: true }
    );
  },

  async reject(action: any, why = '') {
    await TransactionModel.updateOne(
      { ledgerKey: `${action._id}:earning` },
      { $set: { status: 'cancelled', description: why ? `Not approved: ${why}` : 'Submission not approved' } }
    );
  },

  researcherSpent(researcherId: string) {
    return sum({ ownerId: new Types.ObjectId(researcherId), kind: 'charge', status: 'paid' });
  },
};

export class WalletService {
  async participantSummary(participantId: string) {
    const owner = new Types.ObjectId(participantId);
    const [pending, earned, paidOut, inFlight, transactions] = await Promise.all([
      sum({ ownerId: owner, kind: 'earning', status: 'pending' }),
      sum({ ownerId: owner, kind: 'earning', status: 'available' }),
      sum({ ownerId: owner, kind: 'payout', status: 'paid' }),
      sum({ ownerId: owner, kind: 'payout', status: { $in: ['pending', 'processing'] } }),
      TransactionModel.find({ ownerId: owner }).sort({ createdAt: -1 }).limit(100),
    ]);
    return {
      currency: env.DEFAULT_CURRENCY,
      pending,
      available: round(earned - paidOut - inFlight),
      processing: inFlight,
      paidOut,
      totalEarned: round(earned + pending),
      minPayout: config.minPayoutAmount,
      completedStudies: transactions.filter((t: any) => t.kind === 'earning' && t.status !== 'cancelled').length,
      transactions: await withTitles(transactions),
    };
  }

  async savePayoutDetails(participantId: string, details: Record<string, string>) {
    const user = await ParticipantModel.findById(participantId);
    if (!user) throw new AppError('Account not found.', 404);
    user.set('payoutDetails', details);
    await user.save();
    return user.toJSON();
  }

  /** Requests a withdrawal of the available balance (or part of it). Payouts are then sent by the operations team. */
  async requestPayout(participantId: string, amount?: number) {
    const user = await ParticipantModel.findById(participantId);
    if (!user) throw new AppError('Account not found.', 404);
    const details: any = user.payoutDetails;
    if (!details?.accountNumber) throw new AppError('Add your payout details first.', 400);

    const { available, currency } = await this.participantSummary(participantId);
    const value = round(amount ?? available);
    if (value <= 0) throw new AppError('You have no balance to withdraw yet.', 400);
    if (value > available) throw new AppError('That is more than your available balance.', 400);
    if (value < config.minPayoutAmount) throw new AppError(`The minimum withdrawal is ${config.minPayoutAmount} ${currency}.`, 400);

    return TransactionModel.create({
      ownerId: participantId,
      ownerType: 'participant',
      kind: 'payout',
      status: 'pending',
      amount: value,
      currency,
      description: 'Withdrawal request',
      payoutDetails: {
        method: details.method,
        bankName: details.bankName,
        accountName: details.accountName,
        accountNumberLast4: String(details.accountNumber).slice(-4),
      },
    });
  }

  async researcherSummary(researcherId: string) {
    const owner = new Types.ObjectId(researcherId);
    const [spent, transactions] = await Promise.all([
      ledger.researcherSpent(researcherId),
      TransactionModel.find({ ownerId: owner }).sort({ createdAt: -1 }).limit(100),
    ]);
    // Stage 5: payments made for studies, with their receipts or invoices.
    const { FundingModel } = await import('../billing/funding.model');
    const { creditBalance } = await import('../billing/launch.service');
    const fundings = await FundingModel.find({ researcherId: owner, status: { $ne: 'cancelled' } }).sort({ createdAt: -1 }).limit(100);
    const titles = new Map((await SurveyModel.find({ _id: { $in: fundings.map((f: any) => f.surveyId) } }).select('surveyName')).map((x: any) => [String(x._id), x.surveyName]));
    return {
      currency: env.DEFAULT_CURRENCY,
      spent,
      feeRate: config.platformFeeRate,
      credit: await creditBalance(researcherId),
      fundings: fundings.map((f: any) => ({ ...f.toJSON(), title: titles.get(String(f.surveyId)) || 'Study' })),
      transactions: await withTitles(transactions),
    };
  }
}
