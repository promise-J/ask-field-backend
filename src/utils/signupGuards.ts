import { Request, Response, NextFunction } from 'express';
import AppError from '../error-helpers/appError';
import { env } from '../config/env';
import logger from '../config/logger';

/**
 * Participant Stage 1: free checks on sign-up (canvas 1.2 note). They cost nothing and stop
 * the cheapest fakes before anyone reaches the one-time verification.
 */

// Common throwaway-email domains. Short on purpose: it catches the lazy cases, not determined ones.
const THROWAWAY = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', '10minutemail.com', '10minutemail.net',
  'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmailo.com', 'yopmail.com', 'yopmail.net', 'trashmail.com',
  'getnada.com', 'nada.email', 'dispostable.com', 'maildrop.cc', 'mintemail.com', 'throwawaymail.com', 'fakeinbox.com',
  'emailondeck.com', 'mohmal.com', 'moakt.com', 'tmpmail.org', 'tmpmail.net', 'burnermail.io', 'mail.tm', 'mailnesia.com',
]);

export function isThrowawayEmail(email: string) {
  const domain = String(email).split('@')[1]?.toLowerCase().trim() || '';
  return THROWAWAY.has(domain);
}

/** Checks a Cloudflare Turnstile token when TURNSTILE_SECRET is set. Without it the check is skipped. */
export async function turnstileOk(token: string | undefined, ip?: string) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, ...(ip ? { remoteip: ip } : {}) });
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const data: any = await r.json();
    return Boolean(data?.success);
  } catch (err) {
    // If Cloudflare can't be reached, let the person through rather than block every sign-up.
    logger.warn({ err }, 'Turnstile check failed to run; allowing sign-up');
    return true;
  }
}

/** Runs before participant sign-up. Reads the raw body (the bot token is dropped by validation later). */
export const participantSignupGuards = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    if (isThrowawayEmail(req.body?.email)) {
      throw new AppError('Use an email address you keep. Temporary inboxes can’t be used on joinStudy.', 400, 'throwaway_email');
    }
    if (!(await turnstileOk(req.body?.turnstileToken, req.ip))) {
      throw new AppError('We couldn’t check you’re a person. Refresh the page and try again.', 400, 'bot_check_failed');
    }
    next();
  } catch (err) {
    next(err);
  }
};
