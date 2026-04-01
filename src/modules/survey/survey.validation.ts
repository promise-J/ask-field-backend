import { z } from 'zod';


//Participants
export const createSurveySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().nonempty('First name is required'),
  lastName: z.string().min(5),
  signupPlatform: z.enum(['email', 'google']).default('email'),
  receivesUpdates: z.boolean().default(false),
});
