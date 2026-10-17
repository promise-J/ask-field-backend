import app from './app';
import { connectRedis, logger, env, connectDB } from './config';

async function bootstrap() {
  try {
    await connectRedis();
    logger.info("✅ Redis connected");

    app.listen(env.PORT, () => {
      logger.info(`🚀 Server running on port ${env.PORT}`);
    });
    await connectDB();

  } catch (error) {
    logger.error({ error }, "❌ Failed to start server");
    process.exit(1);
  }
}

bootstrap();


