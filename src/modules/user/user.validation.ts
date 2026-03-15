import { z } from 'zod';

export const createParticipantSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  firstName: z.string().nonempty('First name is required'),
  lastName: z.string().min(5),
  signupPlatform: z.enum(['email', 'google']).default('email'),
  receivesUpdates: z.boolean().default(false),
});
export const loginParticipantSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});


export const verifyEmailQuerySchema = z.object({
  email: z.string().email(),
  token: z.string().min(10, "Invalid token"), // adjust min length based on your token generation
});

export const googleAuthSchema = z.object({
  token: z.string().min(10, "Invalid token"),
})