import admin from "firebase-admin";
import {ServiceAccount} from 'firebase-admin'
import dotenv from 'dotenv'
dotenv.config()

// Ensure environment variable exists
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT env variable not set");
}

const serviceAccount: ServiceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT
);

// Fix private key line breaks
const typedServiceAccount: ServiceAccount = {
  ...serviceAccount,
  privateKey: serviceAccount.privateKey?.replace(/\\n/g, "\n") || "",
};

// const serviceAccountTyped: ServiceAccount = {
//   projectId: process.env.FIREBASE_PROJECT_ID,
//   clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
//   privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
// };

// const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT as string)

admin.initializeApp({
  credential: admin.credential.cert(typedServiceAccount)
});

export default admin;