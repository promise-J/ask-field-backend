import { Types } from 'mongoose';
import AppError from '../../error-helpers/appError';
import { config, env } from '../../config/env';
import { sendMail } from '../../utils/mailer';
import { comparePassword } from '../../utils/hash';
import { ParticipantModel } from '../user/models/participant.model';
import { SurveyActionModel, SurveyModel } from '../survey/survey.model';
import { isExpired } from '../survey/survey.service';
import { MessageModel } from '../run/message.model';
import { BookingModel } from '../run/booking.model';
import { TransactionModel } from '../wallet/transaction.model';
import { WalletService } from '../wallet/wallet.service';
import { StudyHideModel } from '../studies/studyHide.model';
import { PayoutLockModel, PayoutQuoteModel } from '../payouts/quote.model';
import { takeLock } from '../payouts/payouts.service';
import { ClosedIdentityModel, SupportCaseModel } from './models';
import { identityHash, load } from './settings.service';

/** Participant Stage 7, canvas 7.2: download your data, and close your account. */

const wallet = new WalletService();
const KEEP_CODES_MS = 365 * 864e5;
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number, cur: string) => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' }).format(n);
  } catch {
    return `${cur} ${n.toFixed(2)}`;
  }
};
const titleOf = (s: any) => s?.plan?.basics?.title || s?.surveyName || 'Study';

/** Everything joinStudy holds about them, in one JSON file. Secrets and one-way codes are left out. */
export async function exportData(id: string) {
  const p = await load(id);
  const owner = new Types.ObjectId(id);
  const [actions, messages, bookings, lines, cases, hidden]: any[][] = await Promise.all([
    SurveyActionModel.find({ participantId: owner }).sort({ startedAt: 1 }),
    MessageModel.find({ participantId: owner }).sort({ createdAt: 1 }),
    BookingModel.find({ participantId: owner }).sort({ start: 1 }),
    TransactionModel.find({ ownerId: owner }).sort({ createdAt: 1 }),
    SupportCaseModel.find({ participantId: owner }).sort({ createdAt: 1 }),
    StudyHideModel.find({ participantId: owner }),
  ]);
  const ids = [...new Set([...actions, ...messages, ...bookings, ...lines, ...cases, ...hidden].map((x) => x.surveyId && String(x.surveyId)).filter(Boolean))];
  const titles = new Map((await SurveyModel.find({ _id: { $in: ids } }).select('plan.basics.title surveyName')).map((s: any) => [String(s._id), titleOf(s)]));
  const t = (sid: unknown) => (sid ? titles.get(String(sid)) || 'Study' : null);
  const v = p.verification || {};
  return {
    exportedAt: new Date().toISOString(),
    about: 'Your joinStudy data. Researchers hold your answers to their own studies; ask them for a copy of those.',
    account: {
      firstName: p.firstName,
      lastName: p.lastName,
      email: p.email,
      country: p.country || null,
      signedUpWith: p.signupPlatform,
      createdAt: p.createdAt,
      agreedTermsAt: p.agreedTermsAt || null,
      lastLoginAt: p.lastLoginAt || null,
      emails: { studies: Boolean(p.receivesUpdates), messages: p.emailPrefs?.messages !== false, news: p.emailPrefs?.news === true },
    },
    profile: p.profile ? (({ parts, ...rest }: any) => rest)(p.profile.toObject ? p.profile.toObject() : p.profile) : null,
    verification: {
      status: v.status || 'none',
      phoneEndsWith: v.phoneLast2 || null,
      phoneConfirmedAt: v.phoneVerifiedAt || null,
      verifiedAt: v.verifiedAt || null,
      note: 'Your selfie and full phone number are held by our verification partners, not by joinStudy.',
    },
    linkedin: p.linkedin?.connectedAt ? { connectedAt: p.linkedin.connectedAt, nameMatches: p.linkedin.nameMatches ?? null } : null,
    payoutMethod: p.payout?.method ? { method: p.payout.method, institution: p.payout.institution || null, endsWith: p.payout.last4, accountName: p.payout.accountName, savedAt: p.payout.savedAt } : null,
    studies: actions.map((a) => ({
      study: t(a.surveyId),
      code: a.code || null,
      status: isExpired(a) ? 'timed-out' : a.status,
      startedAt: a.startedAt,
      finishedAt: a.submittedAt || a.endedAt || null,
      minutes: a.timeSpent ? Math.round(a.timeSpent / 60) : null,
      reward: a.amount ? { amount: a.amount, currency: a.currency || env.DEFAULT_CURRENCY } : null,
      decision: a.reviewedAt ? { at: a.reviewedAt, by: a.review?.by || null, reason: a.review?.reason || null, note: a.review?.note || null } : null,
      question: a.appeal?.askedAt ? { asked: a.appeal.message, askedAt: a.appeal.askedAt, status: a.appeal.status, answer: a.appeal.answer || null, joinStudy: a.appeal.resolution || null } : null,
      leftBecause: a.leftReason || null,
    })),
    bookings: bookings.map((b) => ({ study: t(b.surveyId), start: b.start, end: b.end, status: b.status })),
    messages: messages.map((m) => ({ study: t(m.surveyId), from: m.from === 'participant' ? 'you' : 'researcher', at: m.createdAt, text: m.body })),
    money: lines
      .filter((l) => ['earning', 'payout', 'forfeit'].includes(l.kind))
      .map((l) => ({
        at: l.createdAt,
        kind: l.kind,
        study: t(l.surveyId),
        status: l.status,
        amount: l.amount,
        currency: l.currency,
        ...(l.kind === 'payout' ? { to: `${l.payout?.institution || l.payout?.method || ''} ••${l.payout?.last4 || ''}`.trim(), localAmount: l.payout?.localAmount ?? null, localCurrency: l.payout?.localCurrency ?? null, reference: l.payout?.reference || null, failReason: l.payout?.failReason || null } : {}),
      })),
    hiddenStudies: hidden.map((h) => ({ study: t(h.surveyId), reason: h.reason || null, at: h.createdAt })),
    messagesToJoinStudy: cases.map((c) => ({ reference: c.reference, kind: c.kind, study: t(c.surveyId), topic: c.topic || c.reason, text: c.message, at: c.createdAt, status: c.status })),
  };
}

/** What closing would mean right now: what blocks it, and the money that would be given up. */
export async function closeCheck(id: string, now = new Date()) {
  await load(id);
  const owner = new Types.ObjectId(id);
  // A booked interview is in progress too; leaving it cancels the booking.
  const [inProgress, s] = await Promise.all([
    SurveyActionModel.find({ participantId: owner, status: 'in-progress' }).select('status heldUntil'),
    wallet.participantSummary(id),
  ]);
  const running = inProgress.filter((a: any) => !isExpired(a, now)).length;
  const reasons = [
    running && `you have ${running === 1 ? 'a study' : `${running} studies`} in progress: finish or leave ${running === 1 ? 'it' : 'them'} first`,
    s.processing > 0 && 'a cash-out is on its way: wait until it arrives',
  ].filter(Boolean) as string[];
  return {
    canClose: reasons.length === 0,
    reasons,
    currency: s.currency,
    ready: s.available,
    waiting: s.pending,
    canCashOut: s.available >= config.minPayoutAmount,
    minPayout: config.minPayoutAmount,
  };
}

/**
 * Closes the account. Deletes their name, email, profile, messages and hidden studies; ends work waiting for
 * approval (given up, and the researcher isn't charged); keeps payment records without their name, and one-way
 * codes of their phone and payout account for 12 months.
 */
export async function closeAccount(id: string, input: { password?: string; giveUp?: boolean }, now = new Date()) {
  const p = await load(id, '+password +verification.phoneHash +payout.accountHash');
  if (p.password && !(input.password && (await comparePassword(input.password, p.password)))) throw new AppError('Your password isn’t right.', 400, 'wrong_password');
  // The payout lock stops a cash-out starting while we close.
  await takeLock(id, now);
  try {
    const c = await closeCheck(id, now);
    if (!c.canClose) throw new AppError(`You can’t close your account yet: ${c.reasons.join('; ')}.`, 409, 'cannot_close', c);
    const atStake = round2(c.ready + c.waiting);
    if (atStake > 0 && input.giveUp !== true) {
      throw new AppError(`Closing gives up ${money(atStake, c.currency)}. Tick the box to confirm.`, 409, 'give_up_needed', c);
    }
    const owner = new Types.ObjectId(id);
    // Work waiting for approval: given up. The place opens for someone else and the researcher isn't charged.
    const waiting: any[] = await SurveyActionModel.find({ participantId: owner, status: 'submitted' }).select('_id');
    if (waiting.length) {
      await SurveyActionModel.updateMany({ _id: { $in: waiting.map((a) => a._id) } }, { $set: { status: 'left', endedAt: now, leftReason: 'account-closed' } });
      await TransactionModel.updateMany({ ownerId: owner, kind: 'earning', status: 'pending' }, { $set: { status: 'cancelled', description: 'Given up when the account closed' } });
    }
    if (c.ready > 0) {
      await TransactionModel.create({ ownerId: owner, ownerType: 'participant', kind: 'forfeit', status: 'paid', amount: c.ready, currency: c.currency, description: 'Ready balance given up when the account closed', ledgerKey: `${id}:forfeit` });
    }
    // One-way codes, kept 12 months, so the same person can't come back as someone new.
    const codes = [
      p.verification?.phoneHash && { kind: 'phone', hash: identityHash('phone', p.verification.phoneHash) },
      p.payout?.accountHash && { kind: 'payout', hash: identityHash('payout', p.payout.accountHash) },
    ].filter(Boolean) as { kind: string; hash: string }[];
    if (codes.length) await ClosedIdentityModel.insertMany(codes.map((x) => ({ ...x, closedAt: now, expiresAt: new Date(now.getTime() + KEEP_CODES_MS) })));

    await Promise.all([
      MessageModel.deleteMany({ participantId: owner }),
      StudyHideModel.deleteMany({ participantId: owner }),
      PayoutQuoteModel.deleteMany({ participantId: owner }),
      // Reports about studies are kept (they're about the study, not you); messages to Help are emptied.
      SupportCaseModel.updateMany({ participantId: owner, kind: 'help' }, { $set: { message: '' } }),
    ]);
    const oldEmail = p.email;
    const firstName = p.firstName;
    await ParticipantModel.updateOne(
      { _id: owner },
      {
        $set: { email: `closed+${id}@joinstudy.invalid`, firstName: 'Closed', lastName: 'account', closedAt: now, signedOutAt: now, receivesUpdates: false, isVerified: false, 'verification.status': 'none' },
        $unset: {
          password: 1, googleId: 1, image: 1, profile: 1, linkedin: 1, linkedinState: 1, payout: 1, payoutDetails: 1, payoutHoldUntil: 1,
          pendingEmail: 1, emailChangeToken: 1, emailChangeExpires: 1, emailPrefs: 1, country: 1, lastLoginAt: 1,
          'verification.phoneHash': 1, 'verification.phoneLast2': 1, 'verification.pending': 1, 'verification.sends': 1,
          'verification.selfieRef': 1, 'verification.selfieSession': 1, 'verification.reviewNote': 1, 'verification.channel': 1,
        },
      },
      { strict: false }
    );
    await sendMail({
      to: oldEmail,
      subject: 'Your joinStudy account is closed',
      text: `Hi ${firstName},\n\nYour joinStudy account is closed and you've been signed out. Your details, profile and messages are deleted.${atStake > 0 ? ` The ${money(atStake, env.DEFAULT_CURRENCY)} you chose to give up is no longer yours to cash out.` : ''}\n\nRecords of payments are kept for 7 years, as the law requires, without your name.\n\nThanks for taking part. Questions: hello@joinstudy.io`,
    });
    return { closed: true };
  } finally {
    await PayoutLockModel.deleteOne({ _id: id });
  }
}
