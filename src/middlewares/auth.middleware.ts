import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, UserType } from '../utils/jwt';

/**
 * Checks the Bearer access token.
 * On failure it returns 401 with `message: { name, message }` — the frontend's API layer reads
 * `message.name` to decide between refreshing ("TokenExpiredError") and signing out ("JsonWebTokenError").
 */
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
    const payload = verifyAccessToken(token);
    req.user = { id: payload.id, userType: payload.userType };
    next();
  } catch (err: any) {
    const name = err?.name === 'TokenExpiredError' ? 'TokenExpiredError' : 'JsonWebTokenError';
    res.status(401).json({
      success: false,
      error: name === 'TokenExpiredError' ? 'Your session has expired.' : 'Please sign in again.',
      message: { name, message: err?.message || 'Invalid token' },
    });
  }
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
