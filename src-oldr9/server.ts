import app from './app';
import { connectRedis, logger, env, connectDB } from './config';
import { sendDueReminders } from './modules/run/booking.service';
import { autoApproveDue, sendReviewReminders } from './modules/review/review.service';
import { closeAndSettleDue } from './modules/finish/finish.service';
import { sendStudyAlerts } from './modules/studies/studies.service';
import { expireHolds } from './modules/survey/holds';
import { syncPayouts } from './modules/payouts/payouts.service';
import { sweepClosedIdentities } from './modules/account/models';

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
        // Stage 8: close full or past-date studies, and settle the money of finished ones.
        closeAndSettleDue().catch((error) => logger.error({ error }, 'Closing and settling failed'));
        // Participant Stage 4: free the places of people whose time ran out.
        expireHolds().catch((error) => logger.error({ error }, 'Expiring holds failed'));
        // Participant Stage 6: how each cash-out is doing with the payout provider.
        syncPayouts().catch((error) => logger.error({ error }, 'Payout sync failed'));
      }, REMINDER_EVERY_MS).unref();
      // Participant Stage 3: "A new study fits you" emails, at most one a day per person.
      setInterval(() => sweepClosedIdentities().catch((error) => logger.error({ error }, 'Sweeping closed-account codes failed')), 60 * 60 * 1000).unref();
      setInterval(() => sendStudyAlerts().catch((error) => logger.error({ error }, 'Study alerts failed')), 60 * 60 * 1000).unref();
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


