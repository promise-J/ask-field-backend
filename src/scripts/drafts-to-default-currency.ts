/**
 * Alpha feedback: studies are priced in DEFAULT_CURRENCY (US dollars). Drafts saved while the server ran in another
 * currency (naira) would otherwise keep it.
 *
 *   npm run drafts-to-default-currency            (lists them)
 *   npm run drafts-to-default-currency -- --apply (moves them to DEFAULT_CURRENCY)
 *
 * Only unpaid drafts move. Their pay per person was in the old currency, so it's cleared and the researcher sees
 * "Set the pay" again, starting from the suggested hourly rate. Paid, live and closed studies keep their currency.
 */
import { connectDB, disconnectDB } from '../config/database';
import { env } from '../config/env';
import { SurveyModel } from '../modules/survey/survey.model';
import { FundingModel } from '../modules/billing/funding.model';

async function main() {
  await connectDB();
  const drafts: any[] = await SurveyModel.find({ status: 'draft', currency: { $ne: env.DEFAULT_CURRENCY } }).select('surveyName currency plan.pay');
  const paid = new Set((await FundingModel.find({ surveyId: { $in: drafts.map((d) => d._id) }, status: 'paid' }).select('surveyId')).map((f: any) => String(f.surveyId)));
  const move = drafts.filter((d) => !paid.has(String(d._id)));
  for (const d of move) console.log(`${d._id} · ${d.surveyName || 'Untitled'} · ${d.currency}${d.plan?.pay?.perPerson ? ` · pay ${d.plan.pay.perPerson} (will be cleared)` : ''}`);
  if (!process.argv.includes('--apply')) {
    console.log(`\n${move.length} unpaid draft(s) aren't in ${env.DEFAULT_CURRENCY}${paid.size ? ` (${paid.size} paid one(s) left alone)` : ''}. Run with --apply to move them.`);
  } else {
    for (const d of move) {
      await SurveyModel.updateOne({ _id: d._id, status: 'draft' }, { $set: { currency: env.DEFAULT_CURRENCY }, $unset: { 'plan.pay.perPerson': 1 } });
    }
    console.log(`Moved ${move.length} draft(s) to ${env.DEFAULT_CURRENCY}.`);
  }
  await disconnectDB();
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
