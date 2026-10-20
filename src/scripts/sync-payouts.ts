/** Participant Stage 6: asks the payout provider about every cash-out on its way, now (the server also does this every 5 minutes). */
import { connectDB, disconnectDB } from '../config/database';
import { syncPayouts } from '../modules/payouts/payouts.service';

connectDB()
  .then(syncPayouts)
  .then((r) => console.log(`Sent: ${r.sent}`))
  .then(() => disconnectDB())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
