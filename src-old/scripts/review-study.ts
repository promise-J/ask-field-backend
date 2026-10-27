/**
 * The team's side of Stage 5 until there's an admin screen.
 *
 *   npm run review-study -- list
 *   npm run review-study -- approve <studyId>
 *   npm run review-study -- changes <studyId> "What to change"
 *   npm run review-study -- reject <studyId> "Why we can't run it"   (refunds everything)
 *   npm run review-study -- paid <invoice number>                    (an invoice was paid by bank transfer)
 */
import { connectDB, disconnectDB } from '../config/database';
import { approve, markInvoicePaid, reject, requestChanges, reviewQueue } from '../modules/billing/launch.service';

async function main() {
  const [cmd, id, note] = process.argv.slice(2);
  await connectDB();
  if (!cmd || cmd === 'list') {
    const q = await reviewQueue();
    if (!q.length) console.log('Nothing waiting.');
    for (const s of q as any[]) {
      const flagged = (s.review?.checks || []).filter((c: any) => !c.ok).map((c: any) => c.label);
      console.log(`${s._id} · ${s.launchStage} · ${s.surveyName}${flagged.length ? ` · flagged: ${flagged.join(', ')}` : ''}`);
    }
  } else if (cmd === 'approve') console.log(`Live: ${(await approve(id)).surveyName}`);
  else if (cmd === 'changes') console.log(`Asked for changes: ${(await requestChanges(id, note)).surveyName}`);
  else if (cmd === 'reject') console.log(`Rejected and refunded: ${(await reject(id, note)).surveyName}`);
  else if (cmd === 'paid') console.log(`Marked paid: ${(await markInvoicePaid(id)).number}`);
  else console.log('Usage: review-study [list] | approve <id> | changes <id> "<note>" | reject <id> "<note>" | paid <invoice number>');
  await disconnectDB();
}
main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
