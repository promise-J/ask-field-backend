import mongoose from 'mongoose';
import { env } from './env';
import logger from './logger';

export async function connectDB(uri: string = env.MONGO_URI) {
  await mongoose.connect(uri);
  logger.info('✅ MongoDB connected');
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
