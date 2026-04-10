"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
require("dotenv/config");
const zod_1 = require("zod");
const envSchema = zod_1.z.object({
    PORT: zod_1.z.string().default('5000'),
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']),
    MONGO_URL: zod_1.z.string(),
    FIREBASE_SERVICE_ACCOUNT: zod_1.z.string(),
    FRONTEND_BASE_URL: zod_1.z.string(),
    BREVO_API_KEY: zod_1.z.string(),
    EMAIL_FROM: zod_1.z.string(),
    APP_NAME: zod_1.z.string(),
    REFRESH_SECRET: zod_1.z.string(),
    ACCESS_SECRET: zod_1.z.string(),
    REDIS_URL: zod_1.z.string().optional(),
});
exports.env = envSchema.parse(process.env);
