/**
 * Review a pending institution verification until there is an admin screen.
 *
 *   npm run review-verification -- list
 *   npm run review-verification -- ada@ngo.org verified
 *   npm run review-verification -- ada@ngo.org rejected "Page doesn't show this person"
 */
import { connectDB, disconnectDB } from '../config/database';
import { ResearcherModel } from '../modules/user/models/researcher.model';
import { reviewVerification } from '../modules/user/services/setup.service';

async function main() {
  const [email, decision, note] = process.argv.slice(2);
  await connectDB();
  if (!email || email === 'list') {
    const pending = await ResearcherModel.find({ 'institutionVerification.status': 'pending' }).select('email firstName lastName organizationName organizationType institutionVerification');
    if (!pending.length) console.log('No pending requests.');
    for (const r of pending as any[]) {
      const v = r.institutionVerification;
      console.log(`${r.email} · ${r.firstName} ${r.lastName} · ${r.organizationName} (${r.organizationType}) · ${v.method} · ${v.url ?? v.email ?? ''}`);
    }
  } else if (decision === 'verified' || decision === 'rejected') {
    const r: any = await reviewVerification(email, decision, note);
    console.log(`${r.email} is now ${r.institutionVerification.status}.`);
  } else {
    console.log('Usage: review-verification [list] | <email> verified | <email> rejected "<reason>"');
  }
  await disconnectDB();
}
main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
