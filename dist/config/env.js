"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
require("dotenv/config");
const zod_1 = require("zod");
const envSchema = zod_1.z.object({
    PORT: zod_1.z.string().default('5000'),
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']),
    MONGO_URI: zod_1.z.string(),
    JWT_SECRET: zod_1.z.string(),
    REDIS_URL: zod_1.z.string().optional(),
});
exports.env = envSchema.parse(process.env);
