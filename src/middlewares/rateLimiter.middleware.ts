import type { Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const isTest = process.env.NODE_ENV === 'test';
const tooMany = (message: string) => ({ success: false, code: 'rate_limited', error: message, message });
const WINDOW = 15 * 60 * 1000;

/** Global API limit per IP. Generous, because dashboards make several calls per page. */
export const rateLimiter = rateLimit({
  windowMs: WINDOW,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: tooMany('Too many requests. Please wait a few minutes and try again.'),
});

const emailOf = (req: Request) => String(req.body?.email ?? req.query?.email ?? '').toLowerCase().trim();

/**
 * Sign-in, sign-up and reset routes. Two limits:
 * - per email address and action (10 sign-in tries, 10 reset steps… in 15 minutes): stops password guessing on
 *   one account without a few wrong passwords also blocking the reset that follows;
 * - per network (200 in 15 minutes): a whole lab or campus often shares one IP address, so this one is loose.
 */
export const authLimiter = [
  rateLimit({
    windowMs: WINDOW,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest,
    message: tooMany('Too many attempts from this network. Please wait 15 minutes and try again.'),
  }),
  rateLimit({
    windowMs: WINDOW,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => isTest || !emailOf(req),
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}|${emailOf(req)}|${req.baseUrl}${req.path}`,
    message: tooMany('Too many attempts for this email. Please wait 15 minutes and try again.'),
  }),
];
