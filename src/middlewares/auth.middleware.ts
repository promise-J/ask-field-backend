import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, UserType } from '../utils/jwt';

/**
 * Checks the Bearer access token.
 * On failure it returns 401 with `message: { name, message }` — the frontend's API layer reads
 * `message.name` to decide between refreshing ("TokenExpiredError") and signing out ("JsonWebTokenError").
 */
/** Things anyone can do for themselves, whatever their role in the workspace they're looking at. */
const PERSONAL = /^\/api\/(researchers\/me\/(account|email|password|email-prefs|close|workspaces)|team\/(invite\/[^/]+\/accept|leave))/;
/** Paying and managing the team: owners and admins only. */
const MONEY_OR_TEAM = /\/(launch\/pay|launch\/cancel-invoice|live\/add-places|finish\/return-to)$|^\/api\/(billing\/test-confirm|researchers\/me\/(team|billing|profile|verification)|team\/(invite|members))/;

const forbid = (res: Response, error: string) => res.status(403).json({ success: false, error, message: error, code: 'role_forbidden' });

/**
 * Stage 9: researchers can work in a workspace they belong to by sending `X-Workspace: <owner id>`.
 * `req.user.id` then becomes the workspace, so every "owned by" check covers the whole team.
 */
async function enterWorkspace(req: Request, res: Response, next: NextFunction) {
  const u = req.user!;
  u.selfId = u.id;
  u.role = 'owner';
  const ws = String(req.headers['x-workspace'] || '');
  if (u.userType !== 'researcher' || !ws || ws === u.id) return next();
  try {
    const { MembershipModel } = await import('../modules/team/membership.model');
    const m: any = /^[a-f\d]{24}$/i.test(ws) ? await MembershipModel.findOne({ workspaceId: ws, researcherId: u.id, status: 'active' }).select('role') : null;
    if (!m) return forbid(res, 'You’re not part of that workspace any more.');
    u.id = ws;
    u.role = m.role;
    const path = req.originalUrl.split('?')[0];
    if (req.method !== 'GET' && !PERSONAL.test(path)) {
      if (m.role === 'viewer') return forbid(res, 'Viewers can see studies but not change them. Ask an admin for a different role.');
      if (m.role === 'researcher' && MONEY_OR_TEAM.test(path)) return forbid(res, 'Only owners and admins can pay or manage the team.');
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Please sign in to continue.',
      message: { name: 'JsonWebTokenError', message: 'Please sign in to continue.' },
    });
  }

  try {
    const payload: any = verifyAccessToken(token);
    req.user = { id: payload.id, userType: payload.userType, iat: payload.iat, sid: payload.sid, at: payload.at };
  } catch (err: any) {
    const name = err?.name === 'TokenExpiredError' ? 'TokenExpiredError' : 'JsonWebTokenError';
    return res.status(401).json({
      success: false,
      error: name === 'TokenExpiredError' ? 'Your session has expired.' : 'Please sign in again.',
      message: { name, message: err?.message || 'Invalid token' },
    });
  }
  if (req.user.userType === 'participant') return participantSession(req, res, next);
  return enterWorkspace(req, res, next);
}

/** Participant Stage 7: a closed account, or a token from before "Sign out everywhere else", is signed out at once. */
async function participantSession(req: Request, res: Response, next: NextFunction) {
  try {
    const { sessionStillValid } = await import('../modules/account/settings.service');
    if (!(await sessionStillValid(req.user!.id, req.user!.iat, req.user!.sid, req.user!.at))) {
      return res.status(401).json({ success: false, error: 'Please sign in again.', message: { name: 'JsonWebTokenError', message: 'Signed out' } });
    }
    req.user!.selfId = req.user!.id;
    req.user!.role = 'owner';
    next();
  } catch (err) {
    next(err);
  }
}

/** Owners and admins only (team management, money). Use after authMiddleware. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role === 'owner' || req.user?.role === 'admin') return next();
  return forbid(res, 'Only owners and admins can do this.');
}

/** Use after authMiddleware to limit a route to one account type. */
export const requireRole =
  (...roles: UserType[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.userType)) {
      const label = roles.length === 1 ? `${roles[0]}s` : 'this account type';
      return res.status(403).json({
        success: false,
        error: `This action is for ${label} only.`,
        message: `This action is for ${label} only.`,
      });
    }
    next();
  };
