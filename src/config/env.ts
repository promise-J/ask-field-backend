import 'dotenv/config';
import { z } from 'zod';


const envSchema = z.object({
  PORT: z.string().default('5000'),
  NODE_ENV: z.enum(['development', 'production', 'test']),
  MONGO_URL: z.string(),
  FIREBASE_SERVICE_ACCOUNT: z.string(),
  FRONTEND_BASE_URL: z.string(),
  BREVO_API_KEY: z.string(),
  EMAIL_FROM: z.string(),
  APP_NAME: z.string(),
  REFRESH_SECRET: z.string(),
  ACCESS_SECRET: z.string(),
  REDIS_URL: z.string().optional(),
});

export const env = envSchema.parse(process.env);