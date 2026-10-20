/**
 * Participant Stage 6: withdrawals requested before payouts were sent by a provider stay "pending" for ever,
 * holding the money and blocking new cash-outs. Pay them by hand first if you want to; then this cancels the rest,
 * so the money is back in each balance.
 *   npm run cancel-old-withdrawals            (lists them)
 *   npm run cancel-old-withdrawals -- --apply
 */
import { connectDB, disconnectDB } from '../config/database';
import { TransactionModel } from '../modules/wallet/transaction.model';

async function main() {
  await connectDB();
  const filter = { kind: 'payout', status: 'pending', 'payout.reference': { $exists: false } };
  const list: any[] = await TransactionModel.find(filter).select('ownerId amount currency createdAt');
  for (const t of list) console.log(`${t._id} · participant ${t.ownerId} · ${t.currency} ${t.amount} · ${t.createdAt.toISOString().slice(0, 10)}`);
  if (process.argv.includes('--apply')) {
    const r = await TransactionModel.updateMany(filter, { $set: { status: 'cancelled', description: 'Old withdrawal request, cancelled: the money is back in your balance' } });
    console.log(`Cancelled ${r.modifiedCount}.`);
  } else {
    console.log(`${list.length} old withdrawal(s). Run with --apply to cancel them.`);
  }
  await disconnectDB();
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
