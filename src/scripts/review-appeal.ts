/**
 * Participant Stage 5: joinStudy's decision on a question a researcher didn't answer (or a participant still disputes),
 * until there's an admin screen.
 *
 *   npm run review-appeal -- list
 *   npm run review-appeal -- overturn <attemptId> "What we found"   (approves it and charges the study)
 *   npm run review-appeal -- uphold <attemptId> "What we found"
 */
import { connectDB, disconnectDB } from '../config/database';
import { escalatedList, resolve } from '../modules/after/after.service';

async function main() {
  const [cmd, id, note] = process.argv.slice(2);
  await connectDB();
  if (!cmd || cmd === 'list') {
    const rows: any[] = await escalatedList();
    if (!rows.length) console.log('Nothing waiting.');
    for (const a of rows) console.log(`${a._id} · ${a.code} · study ${a.surveyId} · asked ${a.appeal?.escalatedAt?.toISOString().slice(0, 10)} · "${a.appeal?.message}"`);
  } else if ((cmd === 'overturn' || cmd === 'uphold') && id && note) {
    console.log(`Done: ${(await resolve(id, cmd, note)).status}`);
  } else {
    console.log('Usage: review-appeal [list] | overturn <attemptId> "note" | uphold <attemptId> "note"');
  }
  await disconnectDB();
}
main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
