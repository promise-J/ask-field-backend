import Redis from 'ioredis';

import {env, logger} from './'

let redis: Redis | null = null;

/**
 * Initialize Redis connection
 */
export function connectRedis(): Redis | null {
  if (!env.REDIS_URL) {
    logger.warn('⚠️ Redis disabled (REDIS_URL not set)');
    return null;
  }

  redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy(times) {
      return Math.min(times * 50, 2000);
    },
  });

  redis.on('connect', () => {
    logger.info('🟢 Redis connecting...');
  });

  redis.on('ready', () => {
    logger.info('🟢 Redis connected');
  });

  redis.on('error', (err) => {
    logger.error({ err }, '🔴 Redis error');
  });

  redis.on('close', () => {
    logger.warn('🟡 Redis connection closed');
  });

  return redis;
}

/**
 * Get Redis instance
 */
export function getRedis(): Redis {
  if (!redis) {
    throw new Error('Redis has not been initialized');
  }
  return redis;
}

/**
 * Graceful shutdown
 */
export async function disconnectRedis() {
  if (redis) {
    await redis.quit();
    logger.info('🟡 Redis disconnected');
  }
}
