/**
 * Participant Stage 6: full account numbers were stored before payout providers held them.
 *   npm run strip-payout-numbers            (counts them)
 *   npm run strip-payout-numbers -- --apply (removes the numbers; people add their payout method again)
 */
import { connectDB, disconnectDB } from '../config/database';
import { ParticipantModel } from '../modules/user/models/participant.model';

async function main() {
  await connectDB();
  const filter = { 'payoutDetails.accountNumber': { $exists: true } };
  const n = await ParticipantModel.countDocuments(filter);
  if (process.argv.includes('--apply')) {
    const r = await ParticipantModel.updateMany(filter, { $unset: { 'payoutDetails.accountNumber': 1 } });
    console.log(`Removed stored account numbers from ${r.modifiedCount} participant(s).`);
  } else {
    console.log(`${n} participant(s) have a full account number stored. Run with --apply to remove them.`);
  }
  await disconnectDB();
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
