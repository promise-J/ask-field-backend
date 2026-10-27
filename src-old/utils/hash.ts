import crypto from 'crypto';
import bcrypt from 'bcrypt';

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
export const comparePassword = (password: string, hash: string) => bcrypt.compare(password, hash);

/** One-way hash for tokens and codes we store (verification links, OTPs, reset tokens). */
export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

export const randomOtp = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/** Constant-time comparison of a plain value against a stored sha256 hash. */
export const matchesHash = (plain: string, hash?: string | null) => {
  if (!hash) return false;
  const a = Buffer.from(sha256(plain));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
