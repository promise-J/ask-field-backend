import admin from "firebase-admin";
import {ServiceAccount} from 'firebase-admin'
import dotenv from 'dotenv'
import { env } from "./config";
dotenv.config()

// Ensure environment variable exists
if (!env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT env variable not set");
}

const serviceAccount: ServiceAccount = JSON.parse(
  env.FIREBASE_SERVICE_ACCOUNT
);

// Fix private key line breaks
const typedServiceAccount: ServiceAccount = {
  ...serviceAccount,
  privateKey: serviceAccount.privateKey?.replace(/\\n/g, "\n") || "",
};

// const serviceAccountTyped: ServiceAccount = {
//   projectId: env.FIREBASE_PROJECT_ID,
//   clientEmail: env.FIREBASE_CLIENT_EMAIL,
//   privateKey: env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
// };

// const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT as string)

admin.initializeApp({
  credential: admin.credential.cert(typedServiceAccount)
});

export default admin;