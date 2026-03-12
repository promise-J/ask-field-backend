"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectRedis = connectRedis;
exports.getRedis = getRedis;
exports.disconnectRedis = disconnectRedis;
const ioredis_1 = __importDefault(require("ioredis"));
const _1 = require("./");
let redis = null;
/**
 * Initialize Redis connection
 */
function connectRedis() {
    if (!_1.env.REDIS_URL) {
        _1.logger.warn('⚠️ Redis disabled (REDIS_URL not set)');
        return null;
    }
    redis = new ioredis_1.default(_1.env.REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        retryStrategy(times) {
            return Math.min(times * 50, 2000);
        },
    });
    redis.on('connect', () => {
        _1.logger.info('🟢 Redis connecting...');
    });
    redis.on('ready', () => {
        _1.logger.info('🟢 Redis connected');
    });
    redis.on('error', (err) => {
        _1.logger.error({ err }, '🔴 Redis error');
    });
    redis.on('close', () => {
        _1.logger.warn('🟡 Redis connection closed');
    });
    return redis;
}
/**
 * Get Redis instance
 */
function getRedis() {
    if (!redis) {
        throw new Error('Redis has not been initialized');
    }
    return redis;
}
/**
 * Graceful shutdown
 */
async function disconnectRedis() {
    if (redis) {
        await redis.quit();
        _1.logger.info('🟡 Redis disconnected');
    }
}
