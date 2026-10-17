import jwt, { SignOptions } from 'jsonwebtoken';
import { env, config } from '../config/env';

export type UserType = 'participant' | 'researcher';

export interface TokenPayload {
  id: string;
  userType: UserType;
}

export function signAccessToken(payload: TokenPayload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL } as SignOptions);
}

export function signRefreshToken(payload: TokenPayload) {
  return jwt.sign(payload, config.refreshSecret, { expiresIn: env.REFRESH_TOKEN_TTL } as SignOptions);
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, config.refreshSecret) as TokenPayload;
}

export function issueTokens(payload: TokenPayload) {
  return { accessToken: signAccessToken(payload), refreshToken: signRefreshToken(payload) };
}
