import mongoose from 'mongoose';
import { env } from './env';

export async function connectDB() {
  await mongoose.connect(env.MONGO_URL);
  console.log('✅ MongoDB connected');
}
