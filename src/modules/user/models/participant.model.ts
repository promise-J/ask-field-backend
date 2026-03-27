import { Schema, model } from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../../../config";

export interface IParticipant extends Document {
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
  isVerified: boolean;
  verificationToken?: string;
  verificationTokenExpires: Date | null;
  otp?: string;
  otpExpires: Date | null;
  signupPlatform: "email" | "google";
  receivesUpdates: boolean;
  image?: {
    imageUrl?: string;
    publicId?: string;
  };
  googleId?: string;
  subscriptionStatus?: string; // optional, used in isSubscriptionActive
  subscriptionExpiry?: Date; // optional, used in isSubscriptionActive
  userType?: string; // optional, used in JWT methods
  isCompleteProfile: boolean;

  // Instance methods
  comparePassword(password: string): Promise<boolean>;
  isSubscriptionActive(): boolean;
  generateAccessToken(): Promise<string>;
  generateRefreshToken(): Promise<string>;
}

const participantSchema = new Schema<IParticipant>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: { type: String, trim: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    isVerified: { type: Boolean, default: false },
    verificationToken: { type: String },
    verificationTokenExpires: { type: Date },
    otp: { type: String },
    otpExpires: { type: Date },
    signupPlatform: {
      type: String,
      enum: ["email", "google"],
      default: "email",
    },
    receivesUpdates: { type: Boolean, default: false },
    googleId: { type: String, unique: true, sparse: true },
    userType: { type: String, default: "participant" },
    image: {
      imageUrl: { type: String },
      publicId: { type: String },
    },
    isCompleteProfile: { type: Boolean, default: false },
  },
  { timestamps: true }
);

participantSchema.pre("save", async function (next) {
  try {
    if (this.isModified("password") && this.password) {
      // const user = this as IUser;
      const hashPassword = await bcrypt.hash(this.password, 10);
      this.password = hashPassword;
    }

    // if (this.userType !== "coach") {
    //   this.isVerifiedCoach = undefined;
    // }

    next();
  } catch (error) {
    return next();
  }
});

participantSchema.methods.comparePassword = async function (password: string) {
  const user = this;
  // console.log({password, userPassword: user.password})
  if (!password || !user.password) {
    throw new Error("Missing password or hash for comparison");
  }
  return await bcrypt.compare(password, user.password);
};

participantSchema.methods.isSubscriptionActive = function () {
  return (
    this.subscriptionStatus === "active" && new Date() < this.subscriptionExpiry
  );
};

participantSchema.methods.generateAccessToken = async function () {
  const token = jwt.sign(
    {
      id: this._id,
      userType: this.userType,
    },
    env.ACCESS_SECRET || "",
    { expiresIn: "1h" }
  );
  return token;
};

participantSchema.methods.generateRefreshToken = async function () {
  const token = jwt.sign(
    {
      id: this._id,
      userType: this.userType,
    },
    env.REFRESH_SECRET || "",
    { expiresIn: "1w" }
  );
  return token;
};

export const ParticipantModel = model("Participant", participantSchema);
