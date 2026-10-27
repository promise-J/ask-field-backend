/**
 * Checks the server's "Continue with Google" settings without printing any secret.
 *
 *   npm run check-google
 *   npm run check-google -- <frontend project id>   (the value of VITE_GOOGLE_PROJECT_ID, to compare the two)
 *
 * It checks that the three FIREBASE_* settings are there, that the private key can be read, that the service
 * account belongs to FIREBASE_PROJECT_ID, and (with network access) that Google accepts the key.
 */
import crypto from 'crypto';
import { env } from '../config/env';
import { projectOfClientEmail, readPrivateKey } from '../utils/firebase';

const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => {
  console.log(`  FIX   ${m}`);
  problems++;
};
let problems = 0;

async function main() {
  const frontendProject = process.argv[2];
  console.log('Google sign-in settings on this server:');
  if (!env.FIREBASE_PROJECT_ID) bad('FIREBASE_PROJECT_ID is empty.');
  else ok(`FIREBASE_PROJECT_ID is set (${env.FIREBASE_PROJECT_ID}).`);

  const owner = projectOfClientEmail(env.FIREBASE_CLIENT_EMAIL);
  if (!env.FIREBASE_CLIENT_EMAIL) bad('FIREBASE_CLIENT_EMAIL is empty.');
  else if (!owner) bad('FIREBASE_CLIENT_EMAIL should look like firebase-adminsdk-xxxx@PROJECT.iam.gserviceaccount.com.');
  else if (env.FIREBASE_PROJECT_ID && owner !== env.FIREBASE_PROJECT_ID) bad(`The service account belongs to project "${owner}", but FIREBASE_PROJECT_ID is "${env.FIREBASE_PROJECT_ID}".`);
  else ok('FIREBASE_CLIENT_EMAIL belongs to that project.');

  const key = readPrivateKey();
  if (!env.FIREBASE_PRIVATE_KEY) bad('FIREBASE_PRIVATE_KEY is empty.');
  else {
    try {
      crypto.createPrivateKey(key);
      ok('FIREBASE_PRIVATE_KEY can be read.');
    } catch {
      bad('FIREBASE_PRIVATE_KEY can’t be read. Paste the whole "private_key" value from the service account JSON, including the BEGIN and END lines.');
    }
  }

  if (frontendProject) {
    if (frontendProject === env.FIREBASE_PROJECT_ID) ok('The frontend uses the same Firebase project.');
    else bad(`The frontend uses project "${frontendProject}", the server "${env.FIREBASE_PROJECT_ID}". They must be the same.`);
  } else {
    console.log(`  note  Make sure the frontend's VITE_GOOGLE_PROJECT_ID is "${env.FIREBASE_PROJECT_ID ?? '?'}" (run again with it to compare).`);
  }

  if (!problems) {
    try {
      const admin = await import('firebase-admin');
      await admin.credential.cert({ projectId: env.FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: key }).getAccessToken();
      ok('Google accepted the service account.');
    } catch (err: any) {
      bad(`Google refused the service account: ${String(err?.message || err).split('\n')[0]}`);
    }
  }

  console.log('\nAlso check in Firebase → Authentication:');
  console.log('  - Sign-in method: Google is enabled.');
  console.log('  - Settings → Authorized domains: joinstudy.io and www.joinstudy.io are listed.');
  console.log(problems ? `\n${problems} thing(s) to fix.` : '\nThe server settings look right.');
  process.exit(problems ? 1 : 0);
}

main();
