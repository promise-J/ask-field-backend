import { Schema, model } from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../../../config";

export interface IResearcher extends Document {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  isVerified: boolean;
  verificationToken?: string;
  verificationTokenExpires: Date | null;
  otp?: string;
  otpExpires: Date | null;
  signupPlatform: "email" | "google";
  image?: {
    imageUrl?: string;
    publicId?: string;
  };
  googleId?: string;
  subscriptionStatus?: string; // optional, used in isSubscriptionActive
  subscriptionExpiry?: Date; // optional, used in isSubscriptionActive
  userType?: string; // optional, used in JWT methods
  isCompleteProfile: boolean;
  jobTitle: string;
  organizationType: string;
  organizationName: string;
  country: string;

  // Instance methods
  comparePassword(password: string): Promise<boolean>;
  isSubscriptionActive(): boolean;
  generateAccessToken(): Promise<string>;
  generateRefreshToken(): Promise<string>;
}

const researcherSchema = new Schema<IResearcher>(
  {
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    verificationToken: { type: String },
    isVerified: { type: Boolean, default: false },
    verificationTokenExpires: { type: Date },
    otp: { type: String },
    otpExpires: { type: Date },
    signupPlatform: {
      type: String,
      enum: ["email", "google"],
      default: "email",
    },
    googleId: { type: String, unique: true, sparse: true },
    userType: { type: String, default: "researcher" },
    jobTitle: { type: String },
    organizationType: { type: String },
    organizationName: { type: String },
    country: { type: String },
    image: {
      imageUrl: { type: String },
      publicId: { type: String },
    },
    isCompleteProfile: { type: Boolean, default: false },
  },
  { timestamps: true }
);

researcherSchema.pre("save", async function (next) {
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

researcherSchema.methods.comparePassword = async function (password: string) {
  const user = this;
  // console.log({password, userPassword: user.password})
  if (!password || !user.password) {
    throw new Error("Missing password or hash for comparison");
  }
  return await bcrypt.compare(password, user.password);
};

researcherSchema.methods.isSubscriptionActive = function () {
  return (
    this.subscriptionStatus === "active" && new Date() < this.subscriptionExpiry
  );
};

researcherSchema.methods.generateAccessToken = async function () {
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

researcherSchema.methods.generateRefreshToken = async function () {
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

export const ResearcherModel = model("Researcher", researcherSchema);
