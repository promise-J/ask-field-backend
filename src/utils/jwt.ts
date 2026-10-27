import jwt, { SignOptions } from 'jsonwebtoken';
import { env, config } from '../config/env';

export type UserType = 'participant' | 'researcher';

export interface TokenPayload {
  id: string;
  userType: UserType;
  /** One sign-in (a device). Lets "Sign out everywhere else" keep this one (Participant Stage 7). */
  sid?: string;
  /** When it was issued, in milliseconds (token `iat` is whole seconds). */
  at?: number;
}

/** A lifetime like "1h" or "28d" in seconds (or null if it can't be read). */
function seconds(ttl: string) {
  const m = /^(\d+)\s*(s|m|h|d)?$/i.exec(ttl.trim());
  if (!m) return null;
  return Number(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[(m[2] || 's').toLowerCase()];
}

/**
 * With SESSION_IDLE_MINUTES on (20 by default), no token outlives it: the browser renews the sign-in while the
 * person is active, so 20 minutes without activity ends it on the server too.
 */
function capped(ttl: string) {
  const idle = config.idleMinutes * 60;
  if (!idle) return ttl;
  const s = seconds(ttl);
  return s != null && s < idle ? s : idle;
}

export function signAccessToken(payload: TokenPayload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: capped(env.ACCESS_TOKEN_TTL) } as SignOptions);
}

export function signRefreshToken(payload: TokenPayload) {
  return jwt.sign(payload, config.refreshSecret, { expiresIn: capped(env.REFRESH_TOKEN_TTL) } as SignOptions);
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, config.refreshSecret) as TokenPayload;
}

export function issueTokens(input: TokenPayload) {
  const payload: TokenPayload = { id: input.id, userType: input.userType, ...(input.sid ? { sid: input.sid } : {}), at: Date.now() };
  return { accessToken: signAccessToken(payload), refreshToken: signRefreshToken(payload) };
}
