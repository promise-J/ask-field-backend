import { isValidObjectId } from 'mongoose';
import AppError from '../../error-helpers/appError';
import { env } from '../../config/env';
import { sendMail } from '../../utils/mailer';
import { randomToken, sha256 } from '../../utils/hash';
import { ResearcherModel } from '../user/models/researcher.model';
import { MembershipModel, ROLES, type Role } from './membership.model';

/**
 * Stage 9: workspaces. Each researcher's account is a workspace; they can invite people into it with a role,
 * and belong to other workspaces too. The app sends `X-Workspace` to choose which one it's working in.
 */

const INVITE_DAYS = 7;
const appUrl = (path: string) => `${env.FRONTEND_URL.replace(/\/$/, '')}${path}`;
const fullName = (r: any) => [r?.firstName, r?.lastName].filter(Boolean).join(' ');
export const ROLE_WORDS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  researcher: 'Researcher',
  viewer: 'Viewer',
};
const ROLE_NOTES: Record<string, string> = {
  admin: 'everything, including paying and inviting people',
  researcher: 'plan, run and review studies (not paying or managing the team)',
  viewer: 'see studies, results and statements',
};

export async function workspaceName(ownerId: unknown) {
  const r: any = await ResearcherModel.findById(ownerId).select('firstName lastName organizationName');
  return r?.organizationName || fullName(r) || 'Workspace';
}

/** The workspaces this person can work in: their own first. */
export async function workspacesFor(selfId: string) {
  const own = { workspaceId: selfId, name: await workspaceName(selfId), role: 'owner' as Role, own: true };
  const ms: any[] = await MembershipModel.find({ researcherId: selfId, status: 'active' }).sort({ acceptedAt: 1 });
  const others = [];
  for (const m of ms) {
    const owner: any = await ResearcherModel.findById(m.workspaceId).select('firstName lastName organizationName closedAt');
    if (!owner || owner.closedAt) continue;
    others.push({ workspaceId: String(m.workspaceId), name: owner.organizationName || fullName(owner), ownerName: fullName(owner), role: m.role as Role, own: false });
  }
  return [own, ...others];
}

/** Members and open invites of a workspace. */
export async function teamView(workspaceId: string, selfId: string, role: Role) {
  const owner: any = await ResearcherModel.findById(workspaceId).select('firstName lastName email');
  const ms: any[] = await MembershipModel.find({ workspaceId, status: { $in: ['invited', 'active'] } }).sort({ createdAt: 1 });
  const people: any[] = await ResearcherModel.find({ _id: { $in: ms.filter((m) => m.researcherId).map((m) => m.researcherId) } }).select('firstName lastName email');
  const byId = new Map(people.map((p) => [String(p._id), p]));
  const now = Date.now();
  return {
    workspaceId,
    name: await workspaceName(workspaceId),
    myRole: role,
    canManage: role === 'owner' || role === 'admin',
    members: [
      { membershipId: null, researcherId: workspaceId, name: fullName(owner), email: owner?.email || '', role: 'owner' as Role, you: workspaceId === selfId },
      ...ms
        .filter((m) => m.status === 'active')
        .map((m) => {
          const p = byId.get(String(m.researcherId));
          return { membershipId: String(m._id), researcherId: String(m.researcherId), name: fullName(p) || m.email, email: p?.email || m.email, role: m.role as Role, you: String(m.researcherId) === selfId };
        }),
    ],
    invites: ms
      .filter((m) => m.status === 'invited')
      .map((m) => ({ membershipId: String(m._id), email: m.email, role: m.role as Role, invitedAt: m.updatedAt, expiresAt: m.expiresAt, expired: !m.expiresAt || m.expiresAt.getTime() < now })),
  };
}

async function sendInvite(m: any, inviterId: string) {
  const token = randomToken(24);
  m.tokenHash = sha256(token);
  m.expiresAt = new Date(Date.now() + INVITE_DAYS * 864e5);
  await m.save();
  const inviter: any = await ResearcherModel.findById(inviterId).select('firstName lastName');
  const ws = await workspaceName(m.workspaceId);
  await sendMail({
    to: m.email,
    subject: `${fullName(inviter) || 'Someone'} invited you to ${ws} on joinStudy`,
    text: `You're invited to the ${ws} workspace on joinStudy as ${ROLE_WORDS[m.role as Role]}: ${ROLE_NOTES[m.role]}.\n\nJoin here (the link works for ${INVITE_DAYS} days): ${appUrl(`/join/${token}`)}`,
  });
  return token;
}

export async function invite(workspaceId: string, inviterId: string, input: { email: string; role: (typeof ROLES)[number] }) {
  const email = input.email.trim().toLowerCase();
  const owner: any = await ResearcherModel.findById(workspaceId).select('email');
  if (owner?.email === email) throw new AppError('That’s the workspace owner.', 409, 'already_member');
  const existing: any = await MembershipModel.findOne({ workspaceId, email, status: { $in: ['invited', 'active'] } });
  if (existing?.status === 'active') throw new AppError('They’re already in this workspace.', 409, 'already_member');
  const member = await ResearcherModel.findOne({ email }).select('_id');
  if (member && (await MembershipModel.exists({ workspaceId, researcherId: member._id, status: 'active' }))) throw new AppError('They’re already in this workspace.', 409, 'already_member');
  const m: any = existing || new MembershipModel({ workspaceId, email, role: input.role, invitedBy: inviterId });
  m.role = input.role;
  m.invitedBy = inviterId;
  await sendInvite(m, inviterId);
  return teamView(workspaceId, inviterId, 'owner');
}

async function membership(workspaceId: string, id: string) {
  if (!isValidObjectId(id)) throw new AppError('Not found.', 404);
  const m: any = await MembershipModel.findOne({ _id: id, workspaceId, status: { $in: ['invited', 'active'] } });
  if (!m) throw new AppError('Not found.', 404);
  return m;
}

export async function resendInvite(workspaceId: string, inviterId: string, id: string) {
  const m = await membership(workspaceId, id);
  if (m.status !== 'invited') throw new AppError('They’ve already joined.', 409);
  await sendInvite(m, inviterId);
  return { sent: true };
}

export async function changeRole(workspaceId: string, selfId: string, myRole: Role, id: string, role: (typeof ROLES)[number]) {
  const m = await membership(workspaceId, id);
  if (String(m.researcherId) === selfId) throw new AppError('Ask another admin or the owner to change your role.', 409, 'own_role');
  if (myRole !== 'owner' && m.role === 'admin' && role !== 'admin') throw new AppError('Only the owner can change another admin’s role.', 403, 'role_forbidden');
  m.role = role;
  await m.save();
  return { membershipId: String(m._id), role };
}

/** Remove someone (or cancel an invite). They keep their own account and workspace. */
export async function removeMember(workspaceId: string, myRole: Role, id: string) {
  const m = await membership(workspaceId, id);
  if (myRole !== 'owner' && m.role === 'admin' && m.status === 'active') throw new AppError('Only the owner can remove an admin.', 403, 'role_forbidden');
  m.status = 'removed';
  m.tokenHash = undefined;
  await m.save();
  return { removed: true };
}

/** Leave a workspace you were invited to. */
export async function leave(selfId: string, workspaceId: string) {
  const m: any = isValidObjectId(workspaceId) ? await MembershipModel.findOne({ workspaceId, researcherId: selfId, status: 'active' }) : null;
  if (!m) throw new AppError('You’re not in that workspace.', 404);
  m.status = 'removed';
  await m.save();
  return { left: true };
}

async function byToken(token: string) {
  const m: any = await MembershipModel.findOne({ tokenHash: sha256(String(token || '')), status: 'invited' }).select('+tokenHash');
  if (!m) throw new AppError('This invite has been used or cancelled. Ask for a new one.', 404, 'invite_not_found');
  if (!m.expiresAt || m.expiresAt.getTime() < Date.now()) throw new AppError('This invite has expired. Ask for a new one.', 410, 'invite_expired');
  return m;
}

/** What the invite page shows before signing in. */
export async function inviteInfo(token: string) {
  const m = await byToken(token);
  const inviter: any = await ResearcherModel.findById(m.invitedBy).select('firstName lastName');
  const hasAccount = Boolean(await ResearcherModel.exists({ email: m.email, closedAt: { $exists: false } }));
  return { workspace: await workspaceName(m.workspaceId), inviter: fullName(inviter), email: m.email, role: m.role as Role, roleNote: ROLE_NOTES[m.role], expiresAt: m.expiresAt, hasAccount };
}

export async function acceptInvite(token: string, selfId: string) {
  const m = await byToken(token);
  const me: any = await ResearcherModel.findById(selfId).select('email');
  if (!me) throw new AppError('Sign in as a researcher to join.', 403);
  if (me.email !== m.email) throw new AppError(`This invite is for ${m.email}. Sign in with that address, or ask for a new invite.`, 403, 'wrong_account', { email: m.email });
  if (String(m.workspaceId) === selfId) throw new AppError('That’s your own workspace.', 409);
  m.researcherId = selfId;
  m.status = 'active';
  m.acceptedAt = new Date();
  m.tokenHash = undefined;
  await m.save();
  return { workspaceId: String(m.workspaceId), name: await workspaceName(m.workspaceId), role: m.role as Role };
}
