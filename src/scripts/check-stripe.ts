/**
 * Checks the server's card-payment (Stripe) settings without printing any secret.
 *
 *   npm run check-stripe -- https://api.joinstudy.io     (the public address of this API, to find the webhook)
 *
 * It checks the three STRIPE_* settings, that both keys are the same mode (test or live), that Stripe accepts the
 * secret key, that the account can take payments in DEFAULT_CURRENCY, and that a webhook sends
 * payment_intent.succeeded to <API>/api/billing/webhook.
 */
import { env } from '../config/env';
import { stripe } from '../modules/billing/provider';

let problems = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => {
  console.log(`  FIX   ${m}`);
  problems++;
};
const mode = (k?: string) => (k?.includes('_live_') ? 'live' : k?.includes('_test_') ? 'test' : null);

async function main() {
  const apiBase = (process.argv[2] || '').replace(/\/$/, '');
  const sk = env.STRIPE_SECRET_KEY;
  const pk = env.STRIPE_PUBLISHABLE_KEY;
  console.log('Card payment settings on this server:');
  if (!sk) bad('STRIPE_SECRET_KEY is empty (Stripe → Developers → API keys → Secret key, starts with sk_).');
  else if (!/^(sk|rk)_(live|test)_/.test(sk)) bad('STRIPE_SECRET_KEY should start with sk_live_ or sk_test_.');
  else ok(`STRIPE_SECRET_KEY is set (${mode(sk)} mode).`);
  if (!pk) bad('STRIPE_PUBLISHABLE_KEY is empty (starts with pk_). Without it the card form can’t load.');
  else if (!/^pk_(live|test)_/.test(pk)) bad('STRIPE_PUBLISHABLE_KEY should start with pk_live_ or pk_test_.');
  else ok(`STRIPE_PUBLISHABLE_KEY is set (${mode(pk)} mode).`);
  if (sk && pk && mode(sk) && mode(pk) && mode(sk) !== mode(pk)) bad(`The secret key is ${mode(sk)} mode but the publishable key is ${mode(pk)} mode. Use a matching pair.`);
  if (env.NODE_ENV === 'production' && mode(sk) === 'test') console.log('  note  This is a test-mode key on a production server: no real money will move.');
  if (!env.STRIPE_WEBHOOK_SECRET) bad('STRIPE_WEBHOOK_SECRET is empty (the webhook’s “Signing secret”, starts with whsec_). Payments are still confirmed when researchers open the page, but slower.');
  else if (!env.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) bad('STRIPE_WEBHOOK_SECRET should start with whsec_.');
  else ok('STRIPE_WEBHOOK_SECRET is set.');

  if (sk) {
    try {
      const acct = await stripe('account');
      ok(`Stripe accepted the secret key (account ${acct.id}${acct.settings?.dashboard?.display_name ? `, ${acct.settings.dashboard.display_name}` : ''}).`);
      if (acct.charges_enabled === false) bad('The Stripe account can’t take payments yet. Finish activating it in the Stripe dashboard.');
      const cur = env.DEFAULT_CURRENCY.toLowerCase();
      if (Array.isArray(acct.supported_currencies) && !acct.supported_currencies.includes(cur)) bad(`The Stripe account doesn’t support ${env.DEFAULT_CURRENCY}.`);
    } catch (err: any) {
      bad(err?.statusCode ? `Stripe refused the secret key: ${err.message}` : `Couldn’t reach Stripe from this server (${err?.message || err}). Check its internet access.`);
    }
    try {
      const hooks = (await stripe('webhook_endpoints?limit=100')).data || [];
      const ours = hooks.filter((h: any) => /\/api\/billing\/webhook$/.test(h.url) && (!apiBase || h.url === `${apiBase}/api/billing/webhook`));
      const good = ours.filter((h: any) => h.status === 'enabled' && (h.enabled_events.includes('*') || h.enabled_events.includes('payment_intent.succeeded')));
      if (good.length) ok(`A webhook sends payment_intent.succeeded to ${good[0].url}.`);
      else if (ours.length) bad(`The webhook ${ours[0].url} is ${ours[0].status} or doesn’t send payment_intent.succeeded. Add that event.`);
      else bad(`No webhook points at ${apiBase || '<your API>'}/api/billing/webhook. In Stripe → Developers → Webhooks, add it with the event payment_intent.succeeded, then copy its signing secret into STRIPE_WEBHOOK_SECRET.`);
    } catch (err: any) {
      bad(`Couldn’t list the webhooks: ${err?.message || err}`);
    }
  }
  console.log(problems ? `\n${problems} thing(s) to fix. Until then, researchers can still pay by invoice.` : '\nCard payments are ready.');
  process.exit(problems ? 1 : 0);
}

main();
