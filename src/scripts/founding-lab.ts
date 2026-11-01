/**
 * Founding labs, until there's an admin screen. An accepted lab shows the "Founding lab" badge on its studies.
 *
 *   npm run founding-lab -- list
 *   npm run founding-lab -- accept <email>
 *   npm run founding-lab -- remove <email>    (back to "waiting": the badge goes)
 */
import { connectDB, disconnectDB } from '../config/database';
import { LeadModel } from '../modules/leads/lead.model';

async function main() {
  const [cmd, email] = process.argv.slice(2);
  await connectDB();
  if (!cmd || cmd === 'list') {
    const rows: any[] = await LeadModel.find({ type: 'founding-lab' }).sort({ createdAt: -1 }).limit(200);
    if (!rows.length) console.log('No founding-lab requests.');
    for (const l of rows) console.log(`${l.email} · ${l.status} · ${l.organization || l.name || ''}`);
  } else if (cmd === 'accept' || cmd === 'remove') {
    const r = await LeadModel.updateOne({ type: 'founding-lab', email: String(email || '').toLowerCase().trim() }, { $set: { status: cmd === 'accept' ? 'joined' : 'waiting' } });
    console.log(r.matchedCount ? `${cmd === 'accept' ? 'Accepted' : 'Removed'}: ${email}` : `No founding-lab request from ${email}.`);
  } else console.log('Usage: founding-lab [list] | accept <email> | remove <email>');
  await disconnectDB();
}
main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
