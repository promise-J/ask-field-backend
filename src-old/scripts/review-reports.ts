/**
 * Participant Stage 7: messages from Help and reports about studies, until there's an admin screen.
 *
 *   npm run review-reports -- list
 *   npm run review-reports -- close <JS-HP-… or JS-RP-…> "What we did"
 *   npm run review-reports -- release <studyId> "What we found"   (lifts a pause after reports, closes its reports)
 *
 * To stop a study that broke the rules, close it from the researcher's side and contact the researcher.
 */
import { connectDB, disconnectDB } from '../config/database';
import { closeCase, openCases, releaseStudy } from '../modules/account/help.service';

async function main() {
  const [cmd, id, note] = process.argv.slice(2);
  await connectDB();
  if (!cmd || cmd === 'list') {
    const rows = await openCases();
    if (!rows.length) console.log('Nothing open.');
    for (const c of rows) console.log(`${c.reference} · ${c.what}${c.study ? ` · ${c.study}` : ''} · ${c.at.toISOString().slice(0, 10)}${c.message ? ` · "${c.message.slice(0, 160)}"` : ''}`);
  } else if (cmd === 'close' && id && note) {
    console.log(`Closed ${(await closeCase(id, note)).reference}.`);
  } else if (cmd === 'release' && id && note) {
    const r = await releaseStudy(id, note);
    console.log(`Released. ${r.reportsClosed} report(s) closed.`);
  } else {
    console.log('Usage: review-reports [list] | close <reference> "note" | release <studyId> "note"');
  }
  await disconnectDB();
}
main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
