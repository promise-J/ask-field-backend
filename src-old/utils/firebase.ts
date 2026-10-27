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
export async function verifyFirebaseIdToken(idToken: string): Promise<GoogleProfile> {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    throw new AppError("Google sign-in isn't set up on the server yet. Please sign up with email.", 503);
  }
  // Loaded lazily so the API starts quickly and tests don't need Firebase.
  const admin = await import('firebase-admin');
  const app =
    admin.apps.length > 0
      ? admin.app()
      : admin.initializeApp({
          credential: admin.credential.cert({
            projectId: env.FIREBASE_PROJECT_ID,
            clientEmail: env.FIREBASE_CLIENT_EMAIL,
            privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          }),
        });
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
    throw new AppError('We could not verify your Google sign-in. Please try again.', 401);
  }
}
