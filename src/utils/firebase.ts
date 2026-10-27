import { env } from '../config/env';
import AppError from '../error-helpers/appError';

export interface GoogleProfile {
  googleId: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  imageUrl?: string;
}

/**
 * Verifies a Firebase ID token from the frontend's "Continue with Google" button.
 * Needs FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (a Firebase service account).
 */
/**
 * FIREBASE_PRIVATE_KEY as hosting dashboards store it: often wrapped in quotes, with "\n" for new lines.
 * Exported for the check-google script.
 */
export function readPrivateKey(raw = env.FIREBASE_PRIVATE_KEY || '') {
  return raw.trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
}

/** The project a service account belongs to, from its email (name@PROJECT.iam.gserviceaccount.com). */
export const projectOfClientEmail = (email = '') => email.match(/@([^.]+)\.iam\.gserviceaccount\.com$/)?.[1] ?? null;

const NOT_SET_UP = "Google sign-in isn't set up correctly on our side. Please use your email for now.";

let appPromise: Promise<any> | null = null;
async function firebaseApp() {
  if (!appPromise) {
    appPromise = (async () => {
      // Loaded lazily so the API starts quickly and tests don't need Firebase.
      const admin = await import('firebase-admin');
      if (admin.apps.length > 0) return admin.app();
      try {
        return admin.initializeApp({
          credential: admin.credential.cert({ projectId: env.FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: readPrivateKey() }),
        });
      } catch (err: any) {
        appPromise = null;
        console.error('[google] The Firebase service account could not be loaded. Check FIREBASE_PRIVATE_KEY:', err?.message);
        throw new AppError(NOT_SET_UP, 503, 'google_not_configured');
      }
    })();
  }
  return appPromise;
}

/**
 * Verifies a Firebase ID token from the frontend's "Continue with Google" button.
 * Needs FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (a Firebase service account), from the
 * same Firebase project as the frontend's VITE_GOOGLE_* settings. Problems are logged with the real reason
 * (run `npm run check-google` to test the settings).
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<GoogleProfile> {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error('[google] Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY on the server.');
    throw new AppError("Google sign-in isn't set up on the server yet. Please sign up with email.", 503, 'google_not_configured');
  }
  const app = await firebaseApp();
  try {
    const decoded = await app.auth().verifyIdToken(idToken);
    if (!decoded.email) throw new AppError('Your Google account has no email address.', 400);
    const [firstName, ...rest] = (decoded.name || decoded.email.split('@')[0]).split(' ');
    return {
      googleId: decoded.uid,
      email: decoded.email.toLowerCase(),
      emailVerified: Boolean(decoded.email_verified),
      firstName: firstName || 'there',
      lastName: rest.join(' '),
      imageUrl: decoded.picture,
    };
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    const reason = String(err?.message || err);
    console.error('[google] Token check failed:', err?.code || '', reason);
    // The token came from a different Firebase project than the server's service account.
    if (/"aud"|audience|"iss"|issuer/i.test(reason)) throw new AppError(NOT_SET_UP, 503, 'google_project_mismatch');
    if (/expired/i.test(reason)) throw new AppError('Your Google sign-in took too long. Please try again.', 401, 'google_token_expired');
    throw new AppError('We could not verify your Google sign-in. Please try again.', 401, 'google_token_invalid');
  }
}
