import app from './app';
import { connectRedis, logger, env, connectDB } from './config';
import { sendDueReminders } from './modules/run/booking.service';
import { autoApproveDue, sendReviewReminders } from './modules/review/review.service';

const REMINDER_EVERY_MS = 5 * 60 * 1000;

async function bootstrap() {
  try {
    await connectDB();
    connectRedis();


    // Booking reminders (24 hours and 1 hour before). Safe to run on more than one server.
    if (env.NODE_ENV !== 'test') {
      setInterval(() => sendDueReminders().catch((error) => logger.error({ error }, 'Booking reminders failed')), REMINDER_EVERY_MS).unref();
      // Stage 7: approve work nobody decided on in 7 days, and remind researchers 2 days before.
      setInterval(() => {
        autoApproveDue().catch((error) => logger.error({ error }, 'Auto-approve failed'));
        sendReviewReminders().catch((error) => logger.error({ error }, 'Review reminders failed'));
      }, REMINDER_EVERY_MS).unref();
    }

    app.listen(env.PORT, () => {
      logger.info(`🚀 Server running on port ${env.PORT}`);
    });
  } catch (error) {
    logger.error({error}, '❌ Failed to start server');
    process.exit(1);
  }
}

bootstrap();


