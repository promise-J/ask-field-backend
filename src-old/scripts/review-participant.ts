/**
 * Participant Stage 1: decide a selfie a person had to look at (canvas 1.9, "A person will take a look").
 *   npm run review-participant -- approve amaka@example.com
 *   npm run review-participant -- reject amaka@example.com
 *   npm run review-participant -- duplicate amaka@example.com
 * The participant is emailed the outcome.
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { decideReview } from '../modules/verification/verification.service';

async function main() {
  const [decision, email] = process.argv.slice(2);
  if (!['approve', 'reject', 'duplicate'].includes(decision) || !email) {
    console.log('Usage: npm run review-participant -- approve|reject|duplicate <email>');
    process.exit(1);
  }
  await mongoose.connect(env.MONGO_URI);
  const status = await decideReview(email, decision as 'approve' | 'reject' | 'duplicate');
  console.log(`${email}: ${status}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
