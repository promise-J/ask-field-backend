import crypto from 'crypto';
import { Types } from 'mongoose';
import AppError from '../../error-helpers/appError';
import { config, env } from '../../config/env';
import logger from '../../config/logger';
import { sendMail } from '../../utils/mailer';
import { formatMoney } from '../../utils/money';
import { ResearcherModel } from '../user/models/researcher.model';
import { ParticipantModel } from '../user/models/participant.model';
import { TransactionModel } from '../wallet/transaction.model';
import { FundingModel } from '../billing/funding.model';
import { LeadModel } from '../leads/lead.model';
import { SurveyActionModel } from '../survey/survey.model';
import { ReferralModel } from './referral.model';

/**
 * Refer a friend.
 *
 * Researchers: a friend who signs up with your link pays the academic fee on their first study. You earn credit:
 * REFERRAL_SHARE of the fees they pay in their first REFERRAL_WINDOW_DAYS, at most REFERRAL_FRIEND_CAP per friend
 * and REFERRAL_YEAR_CAP a year. Credit comes only after the friend's first paid study, and expires after
 * REFERRAL_CREDIT_MONTHS (it is spent before other credit; see launch.service `creditLedger`).
 *
 * Participants: invites move you up the waitlist (waitlist.service). A friend who finishes verification makes you a
 * "Trusted member". With PARTICIPANT_REFERRAL_REWARD above 0 you also earn cash once their Nth study is approved.
 */

type Kind = 'researcher' | 'participant';
const DAY = 864e5;
const round = (n: number) => Math.round(n * 100) / 100;
const models = { researcher: ResearcherModel, participant: ParticipantModel } as Record<Kind, any>;

/** Free email providers: two people on gmail.com are not the same organisation. */
const PUBLIC_DOMAINS = new Set(
  'gmail.com googlemail.com yahoo.com yahoo.co.uk ymail.com outlook.com hotmail.com hotmail.co.uk live.com msn.com icloud.com me.com mac.com aol.com proton.me protonmail.com gmx.com gmx.de mail.com zoho.com yandex.com yandex.ru'.split(' ')
);
const domainOf = (email: string) => String(email || '').toLowerCase().split('@')[1] || '';
const orgKey = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const shortName = (u: any) => [u?.firstName, u?.lastName ? `${String(u.lastName)[0]}.` : ''].filter(Boolean).join(' ');
export const referralLink = (code: string) => `${env.FRONTEND_URL.replace(/\/$/, '')}/r/${code}`;

// ---------------------------------------------------------------- codes

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
function newCode(firstName: string) {
  const name = String(firstName || '').normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4) || 'JOIN';
  const bytes = crypto.randomBytes(4);
  return `${name}-${[...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('')}`;
}

/** This person's code, made the first time they need it. Codes are unique across both account types. */
export async function ensureCode(kind: Kind, id: string) {
  const user: any = await models[kind].findById(id).select('referralCode firstName');
  if (!user) throw new AppError('Account not found.', 404);
  if (user.referralCode) return user.referralCode as string;
  for (let i = 0; i < 8; i++) {
    const code = newCode(user.firstName);
    const taken = (await ResearcherModel.exists({ referralCode: code })) || (await ParticipantModel.exists({ referralCode: code }));
    if (taken) continue;
    const r = await models[kind].updateOne({ _id: user._id, referralCode: { $in: [null] } }, { $set: { referralCode: code } });
    if (r.modifiedCount) return code;
    return ((await models[kind].findById(id).select('referralCode')) as any).referralCode as string;
  }
  throw new AppError('Could not make a code. Try again.', 500);
}

const cleanCode = (code: unknown) => String(code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);

/** For the sign-up page's "Invited by" banner. Public: only a first name and, for researchers, the organisation. */
export async function lookupCode(raw: string) {
  const code = cleanCode(raw);
  if (!config.referrals.on || !code) throw new AppError('This invite link isn’t valid.', 404, 'invalid_code');
  const r: any = await ResearcherModel.findOne({ referralCode: code, closedAt: null }).select('firstName organizationName companyName');
  if (r) {
    return {
      code,
      type: 'researcher' as const,
      firstName: r.firstName,
      organization: r.organizationName || r.companyName || '',
      offer: `Your first study at the ${Math.round(config.academicFeeRate * 100)}% fee`,
    };
  }
  const p: any = await ParticipantModel.findOne({ referralCode: code, closedAt: null }).select('firstName');
  if (p) return { code, type: 'participant' as const, firstName: p.firstName, organization: '', offer: 'Join joinStudy and get paid for taking part in research' };
  throw new AppError('This invite link isn’t valid.', 404, 'invalid_code');
}

/**
 * Called right after a new account is made (email or Google). Never fails the sign-up: a bad code is ignored.
 * Only same-type invites count (a researcher's link signs up researchers).
 */
export async function attachReferral(kind: Kind, user: any, rawCode?: unknown) {
  const code = cleanCode(rawCode);
  if (!config.referrals.on || !code || !user?._id) return null;
  try {
    const referrer: any = await models[kind].findOne({ referralCode: code }).select('_id email closedAt');
    if (!referrer || referrer.closedAt || String(referrer._id) === String(user._id)) return null;
    await models[kind].updateOne({ _id: user._id }, { $set: { referredBy: referrer._id } });
    const d = domainOf(user.email);
    // Researchers only: participants who share a work domain are told apart by verification (phone and selfie).
    const sameDomain = kind === 'researcher' && d && !PUBLIC_DOMAINS.has(d) && d === domainOf(referrer.email);
    const row = await ReferralModel.create({
      type: kind,
      referrerId: referrer._id,
      friendId: user._id,
      code,
      status: sameDomain ? 'blocked' : 'joined',
      blockedReason: sameDomain ? 'same-email-domain' : undefined,
      windowEnds: kind === 'researcher' ? new Date(new Date(user.createdAt || Date.now()).getTime() + config.referrals.windowDays * DAY) : undefined,
      settled: !!sameDomain,
    });
    if (kind === 'participant') {
      const { refreshScore } = await import('./waitlist.service');
      await refreshScore(String(referrer._id));
    }
    return row;
  } catch (error) {
    logger.error({ error }, 'Attaching a referral failed');
    return null;
  }
}

// ---------------------------------------------------------------- the welcome fee

/**
 * A researcher who signed up with a friend's link pays the academic fee on their first study: every study until one
 * is paid for, and then that first paid study only. Blocked referrals don't get it.
 */
export async function welcomeRate(researcher: any, surveyId?: unknown) {
  if (!config.referrals.on || !researcher?.referredBy) return false;
  const ref: any = await ReferralModel.findOne({ friendId: researcher._id, type: 'researcher' }).select('status');
  if (!ref || ref.status === 'blocked') return false;
  const first: any = await FundingModel.findOne({ researcherId: researcher._id, status: 'paid', purpose: 'launch' }).sort({ paidAt: 1, createdAt: 1 }).select('surveyId');
  if (!first) return true;
  return surveyId != null && String(first.surveyId) === String(surveyId);
}

// ---------------------------------------------------------------- badges (participant study page)

/** "Founding lab" (an accepted founding-lab lead) and "Trusted researcher" (referred a researcher who paid). */
export async function researcherBadges(researchers: { _id: unknown; email?: string }[]) {
  const ids = researchers.map((r) => new Types.ObjectId(String(r._id)));
  const emails = researchers.map((r) => String(r.email || '').toLowerCase()).filter(Boolean);
  const [trusted, labs] = await Promise.all([
    ids.length ? ReferralModel.distinct('referrerId', { type: 'researcher', referrerId: { $in: ids }, status: 'qualified' }) : [],
    emails.length ? LeadModel.find({ type: 'founding-lab', email: { $in: emails }, status: 'joined' }).select('email') : [],
  ]);
  const trustedSet = new Set((trusted as any[]).map(String));
  const labSet = new Set((labs as any[]).map((l) => l.email));
  return new Map(
    researchers.map((r) => {
      const badges: ('founding-lab' | 'trusted-researcher')[] = [];
      if (labSet.has(String(r.email || '').toLowerCase())) badges.push('founding-lab');
      if (trustedSet.has(String(r._id))) badges.push('trusted-researcher');
      return [String(r._id), badges];
    })
  );
}

export async function isTrustedMember(participantId: string) {
  return !!(await ReferralModel.exists({ type: 'participant', referrerId: participantId, status: 'qualified' }));
}

// ---------------------------------------------------------------- what the Refer pages show

function friendStatus(r: any) {
  if (r.status === 'blocked') return 'not-eligible';
  return r.status === 'qualified' ? 'qualified' : 'joined';
}

export async function researcherReferrals(researcherId: string) {
  if (!config.referrals.on) return { on: false as const };
  const code = await ensureCode('researcher', researcherId);
  const rows: any[] = await ReferralModel.find({ type: 'researcher', referrerId: researcherId }).sort({ createdAt: -1 }).limit(200);
  const friends: any[] = rows.length ? await ResearcherModel.find({ _id: { $in: rows.map((r) => r.friendId) } }).select('firstName lastName') : [];
  const byId = new Map(friends.map((f) => [String(f._id), f]));
  const { creditLedger } = await import('../billing/launch.service');
  const ledger = await creditLedger(researcherId);
  const yearEarned = await yearGranted(researcherId);
  const me: any = await ResearcherModel.findById(researcherId).select('referralCardHiddenAt');
  return {
    on: true as const,
    code,
    link: referralLink(code),
    currency: env.DEFAULT_CURRENCY,
    terms: {
      share: config.referrals.share,
      windowDays: config.referrals.windowDays,
      friendCap: config.referrals.friendCap,
      yearCap: config.referrals.yearCap,
      creditMonths: config.referrals.creditMonths,
      friendFeeRate: config.academicFeeRate,
      standardFeeRate: config.platformFeeRate,
    },
    friends: rows.map((r) => ({
      name: shortName(byId.get(String(r.friendId))) || 'A researcher',
      joinedAt: r.createdAt,
      status: friendStatus(r),
      earned: round(r.earned || 0),
      windowEnds: r.windowEnds || null,
    })),
    totals: {
      invited: rows.length,
      paid: rows.filter((r) => r.status === 'qualified').length,
      earned: round(rows.reduce((t, r) => t + (r.earned || 0), 0)),
      thisYear: yearEarned,
      available: ledger.referral,
      nextExpiry: ledger.nextExpiry,
    },
    trusted: rows.some((r) => r.status === 'qualified'),
    cardHidden: !!me?.referralCardHiddenAt,
  };
}

export async function participantReferrals(participantId: string) {
  if (!config.referrals.on) return { on: false as const };
  const code = await ensureCode('participant', participantId);
  const rows: any[] = await ReferralModel.find({ type: 'participant', referrerId: participantId }).sort({ createdAt: -1 }).limit(200);
  const friends: any[] = rows.length ? await ParticipantModel.find({ _id: { $in: rows.map((r) => r.friendId) } }).select('firstName lastName') : [];
  const byId = new Map(friends.map((f) => [String(f._id), f]));
  const { waitlistOf } = await import('./waitlist.service');
  const p: any = await ParticipantModel.findById(participantId);
  return {
    on: true as const,
    code,
    link: referralLink(code),
    currency: env.DEFAULT_CURRENCY,
    reward: config.referrals.participantReward > 0 ? { amount: config.referrals.participantReward, afterStudies: config.referrals.participantStudies } : null,
    friends: rows.map((r) => ({ name: shortName(byId.get(String(r.friendId))) || 'A friend', joinedAt: r.createdAt, status: friendStatus(r), rewarded: !!r.rewardPaidAt })),
    totals: { invited: rows.length, verified: rows.filter((r) => r.status === 'qualified').length },
    trustedMember: rows.some((r) => r.status === 'qualified'),
    waitlist: await waitlistOf(p),
  };
}

export async function hideResearcherCard(researcherId: string) {
  await ResearcherModel.updateOne({ _id: researcherId }, { $set: { referralCardHiddenAt: new Date() } });
  return { hidden: true };
}

// ---------------------------------------------------------------- rewards (hourly)

async function yearGranted(referrerId: unknown, now = new Date()) {
  const rows = await TransactionModel.aggregate([
    { $match: { ownerId: new Types.ObjectId(String(referrerId)), kind: 'credit', source: 'referral', createdAt: { $gte: new Date(now.getTime() - 365 * DAY) } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return round(rows[0]?.total || 0);
}

/** Same organisation name, or the same card on both accounts: treat as one person. */
async function abuseReason(ref: any) {
  const [a, b]: any[] = await Promise.all([
    ResearcherModel.findById(ref.referrerId).select('organizationName companyName'),
    ResearcherModel.findById(ref.friendId).select('organizationName companyName'),
  ]);
  const orgA = orgKey(a?.organizationName || a?.companyName);
  if (orgA && orgA === orgKey(b?.organizationName || b?.companyName)) return 'same-organisation';
  // The test card is always 4242, so only real card payments count.
  const cards = (researcherId: unknown) => FundingModel.distinct('cardLast4', { researcherId, provider: { $ne: 'test' }, cardLast4: { $nin: [null, ''] } });
  const [cardsA, cardsB] = await Promise.all([cards(ref.referrerId), cards(ref.friendId)]);
  if ((cardsA as string[]).some((c) => (cardsB as string[]).includes(c))) return 'same-card';
  return null;
}

async function rewardResearcher(ref: any, now: Date) {
  const friendPaid = await FundingModel.exists({ researcherId: ref.friendId, status: 'paid' });
  const over = ref.windowEnds && new Date(ref.windowEnds) < now;
  if (!friendPaid) {
    if (over) await ReferralModel.updateOne({ _id: ref._id }, { $set: { settled: true } });
    return 0;
  }
  const why = await abuseReason(ref);
  if (why) {
    await ReferralModel.updateOne({ _id: ref._id }, { $set: { status: 'blocked', blockedReason: why, settled: true } });
    return 0;
  }
  if (ref.status === 'joined') {
    await ReferralModel.updateOne({ _id: ref._id, status: 'joined' }, { $set: { status: 'qualified', qualifiedAt: now } });
    ref.status = 'qualified';
  }
  const friend: any = await ResearcherModel.findById(ref.friendId).select('createdAt');
  const fees = await TransactionModel.aggregate([
    {
      $match: {
        ownerId: new Types.ObjectId(String(ref.friendId)),
        kind: 'charge',
        status: { $nin: ['cancelled', 'refunded', 'failed'] },
        createdAt: { $gte: new Date(friend?.createdAt || ref.createdAt), $lte: new Date(ref.windowEnds || now) },
      },
    },
    { $group: { _id: null, total: { $sum: '$fee' } } },
  ]);
  const target = Math.min(round((fees[0]?.total || 0) * config.referrals.share), config.referrals.friendCap);
  const room = Math.max(0, config.referrals.yearCap - (await yearGranted(ref.referrerId, now)));
  const delta = round(Math.min(target - (ref.earned || 0), room));
  if (over) await ReferralModel.updateOne({ _id: ref._id }, { $set: { settled: true } });
  if (delta < 0.01) return 0;
  const total = round((ref.earned || 0) + delta);
  // The key carries the new total, so two servers running the sweep can't grant the same step twice.
  const key = `referral:${ref._id}:${Math.round(total * 100)}`;
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + config.referrals.creditMonths);
  const res = await TransactionModel.updateOne(
    { ledgerKey: key },
    { $setOnInsert: { ownerId: ref.referrerId, ownerType: 'researcher', kind: 'credit', status: 'available', amount: delta, currency: env.DEFAULT_CURRENCY, source: 'referral', expiresAt, description: 'Referral credit' } },
    { upsert: true }
  );
  if (!res.upsertedCount) return 0;
  await ReferralModel.updateOne({ _id: ref._id }, { $set: { earned: total } });
  const r: any = await ResearcherModel.findById(ref.referrerId).select('email firstName closedAt');
  if (r && !r.closedAt) {
    await sendMail({
      to: r.email,
      subject: `You earned ${formatMoney(delta, env.DEFAULT_CURRENCY)} in joinStudy credit`,
      text: `Hi ${r.firstName || ''}, a researcher you invited ran a study, so you've earned ${formatMoney(delta, env.DEFAULT_CURRENCY)} in credit. It's used automatically on your next study and lasts ${config.referrals.creditMonths} months.\n\nSee your referrals: ${env.FRONTEND_URL}/dashboard/researcher/refer`,
    });
  }
  return delta;
}

async function rewardParticipant(ref: any, now: Date) {
  const friend: any = await ParticipantModel.findById(ref.friendId).select('verification.status closedAt');
  const vs = friend?.verification?.status;
  if (!friend || vs === 'duplicate' || vs === 'rejected') {
    await ReferralModel.updateOne({ _id: ref._id }, { $set: { status: 'blocked', blockedReason: friend ? `friend-${vs}` : 'friend-closed', settled: true } });
    return 0;
  }
  if (ref.status === 'joined' && vs === 'verified') {
    await ReferralModel.updateOne({ _id: ref._id, status: 'joined' }, { $set: { status: 'qualified', qualifiedAt: now } });
    ref.status = 'qualified';
    const { refreshScore } = await import('./waitlist.service');
    await refreshScore(String(ref.referrerId));
  }
  if (ref.status !== 'qualified') return 0;
  const amount = config.referrals.participantReward;
  if (!amount) return 0; // stays open, so turning the reward on later still pays friends who reach it
  const approved = await SurveyActionModel.countDocuments({ participantId: ref.friendId, status: 'approved' });
  if (approved < config.referrals.participantStudies) return 0;
  const res = await TransactionModel.updateOne(
    { ledgerKey: `referral:${ref._id}:participant` },
    { $setOnInsert: { ownerId: ref.referrerId, ownerType: 'participant', kind: 'earning', status: 'available', amount, currency: env.DEFAULT_CURRENCY, source: 'referral', description: 'Invite reward' } },
    { upsert: true }
  );
  await ReferralModel.updateOne({ _id: ref._id }, { $set: { rewardPaidAt: now, settled: true } });
  if (!res.upsertedCount) return 0;
  const p: any = await ParticipantModel.findById(ref.referrerId).select('email firstName closedAt');
  if (p && !p.closedAt) {
    await sendMail({ to: p.email, subject: `You earned ${formatMoney(amount, env.DEFAULT_CURRENCY)} for inviting a friend`, text: `Hi ${p.firstName || ''}, a friend you invited has finished ${config.referrals.participantStudies} studies, so ${formatMoney(amount, env.DEFAULT_CURRENCY)} is in your earnings, ready to cash out.` });
  }
  return amount;
}

/** One email per referral credit, 30 days before it expires, while some of it is still unspent. */
async function remindExpiring(now: Date) {
  const soon: any[] = await TransactionModel.find({
    kind: 'credit',
    source: 'referral',
    status: 'available',
    expiresAt: { $gt: now, $lte: new Date(now.getTime() + 30 * DAY) },
    remindedAt: null,
  }).limit(500);
  const { creditLedger } = await import('../billing/launch.service');
  let sent = 0;
  for (const row of soon) {
    const claimed = await TransactionModel.updateOne({ _id: row._id, remindedAt: null }, { $set: { remindedAt: now } });
    if (!claimed.modifiedCount) continue;
    const ledger = await creditLedger(String(row.ownerId), now);
    const left = ledger.buckets.find((b) => b.id === String(row._id))?.left || 0;
    if (left < 0.01) continue;
    const r: any = await ResearcherModel.findById(row.ownerId).select('email firstName closedAt');
    if (!r || r.closedAt) continue;
    await sendMail({
      to: r.email,
      subject: `${formatMoney(left, env.DEFAULT_CURRENCY)} of your joinStudy credit expires soon`,
      text: `Hi ${r.firstName || ''}, ${formatMoney(left, env.DEFAULT_CURRENCY)} of referral credit expires on ${new Date(row.expiresAt).toDateString()}. It's used automatically when you pay for your next study.\n\nStart a study: ${env.FRONTEND_URL}/dashboard/researcher`,
    });
    sent += 1;
  }
  return sent;
}

/** Runs every hour: qualifies friends, grants credit and rewards, blocks look-alike accounts, reminds before expiry. */
export async function sweepReferrals(now = new Date()) {
  if (!config.referrals.on) return { credit: 0, cash: 0, reminders: 0 };
  let credit = 0;
  let cash = 0;
  const open: any[] = await ReferralModel.find({ settled: false, status: { $ne: 'blocked' } }).limit(2000);
  for (const ref of open) {
    try {
      if (ref.type === 'researcher') credit += await rewardResearcher(ref, now);
      else cash += await rewardParticipant(ref, now);
    } catch (error) {
      logger.error({ error, referralId: String(ref._id) }, 'Referral reward failed');
    }
  }
  const reminders = await remindExpiring(now);
  return { credit: round(credit), cash: round(cash), reminders };
}
