/**
 * Participant Stage 2: removes profile answers joinStudy no longer asks for or needs
 * (ethnic group, place and country of birth, "most time before 18", dialect, currency, pay per hour,
 * LinkedIn yes/no, hours per week, and the day of birth). Keeps month and year of birth.
 *   npm run trim-participant-profiles            (shows what would change)
 *   npm run trim-participant-profiles -- --apply (changes it)
 */
import mongoose from 'mongoose';
import { env } from '../config/env';

const DROP = ['ethnic', 'pob', 'countryOfBirth', 'mostTimeSpent', 'mostLifeTime', 'dialect', 'currency', 'payPerHour', 'shareLinkedin', 'workHour', 'dob_day', 'dob_month', 'dob_year'];

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(env.MONGO_URI);
  const col = mongoose.connection.collection('participants');
  const or = DROP.map((k) => ({ [`profile.${k}`]: { $exists: true } }));
  const n = await col.countDocuments({ $or: or });
  console.log(`${n} participant profiles hold answers we no longer keep.`);
  if (apply && n) {
    // Keep the month and year of birth: set the date to the first of the month.
    const cursor = col.find({ 'profile.dateOfBirth': { $type: 'date' }, 'profile.birthYear': { $exists: false } });
    for await (const p of cursor) {
      const d = new Date(p.profile.dateOfBirth);
      await col.updateOne({ _id: p._id }, { $set: { 'profile.birthYear': d.getUTCFullYear(), 'profile.birthMonth': d.getUTCMonth() + 1, 'profile.dateOfBirth': new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)) } });
    }
    const r = await col.updateMany({ $or: or }, { $unset: Object.fromEntries(DROP.map((k) => [`profile.${k}`, ''])) });
    console.log(`Removed them from ${r.modifiedCount} profiles.`);
  } else if (n) console.log('Run again with --apply to remove them.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
