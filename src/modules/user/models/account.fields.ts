import { Schema } from 'mongoose';

/** Fields shared by participant and researcher accounts. Secrets are never selected by default. */
export const accountFields = {
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: {
    type: String,
    select: false,
    required: function (this: { signupPlatform?: string }) {
      return this.signupPlatform !== 'google';
    },
  },
  firstName: { type: String, required: true, trim: true },
  // Optional: some people have one name. Participant sign-up still asks for both.
  lastName: { type: String, trim: true, default: '' },
  signupPlatform: { type: String, enum: ['email', 'google'], default: 'email' },
  googleId: { type: String },
  image: {
    imageUrl: { type: String },
    publicId: { type: String },
  },
  isVerified: { type: Boolean, default: false },
  verificationToken: { type: String, select: false },
  verificationTokenExpires: { type: Date, default: null, select: false },
  verificationSentAt: { type: Date, default: null, select: false },
  otp: { type: String, select: false },
  otpExpires: { type: Date, default: null, select: false },
  otpAttempts: { type: Number, default: 0, select: false },
  resetToken: { type: String, select: false },
  resetTokenExpires: { type: Date, default: null, select: false },
  isCompleteProfile: { type: Boolean, default: false },
  lastLoginAt: { type: Date },
};

/** Removes secrets when a document is turned into JSON for an API response. */
export const hideSecrets = (schema: Schema) => {
  schema.set('toJSON', {
    virtuals: true,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      for (const k of ['password', 'verificationToken', 'verificationTokenExpires', 'verificationSentAt', 'otp', 'otpExpires', 'otpAttempts', 'resetToken', 'resetTokenExpires', 'institutionCode', 'institutionCodeExpires', 'institutionCodeAttempts', 'institutionCodeSentAt', '__v', 'id']) delete ret[k];
      return ret;
    },
  });
};
