import 'dotenv/config';
import { z } from 'zod';


const envSchema = z.object({
  PORT: z.string().default('5000'),
  NODE_ENV: z.enum(['development', 'production', 'test']),
  MONGO_URL: z.string(),
  JWT_SECRET: z.string(),
  REDIS_URL: z.string().optional(),
});

export const env = envSchema.parse(process.env);