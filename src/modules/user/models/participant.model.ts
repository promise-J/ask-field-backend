import { Schema, model } from 'mongoose';
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken';

const participantSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, trim: true },
    password: { type: String, trim: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    isVerified: { type: Boolean, default: false },
    isOnBoardingComplete: { type: Boolean, default: false },
    signupPlatform: { type: String, enum: ["email", "google"], default: "email" },
    receivesUpdates: { type: Boolean, default: false },
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
  
  participantSchema.methods.generateAccessToken = async function (secretToken: string) {
    const token = jwt.sign(
      {
        id: this._id,
        userType: this.userType,
      },
      secretToken,
      { expiresIn: "1h" }
    );
    return token;
  };
  
  participantSchema.methods.generateRefreshToken = async function (secretToken: string) {
    const token = jwt.sign(
      {
        id: this._id,
        userType: this.userType,
      },
      secretToken,
      { expiresIn: "4w" }
    );
    return token;
  };

export const ParticipantModel = model('Participant', participantSchema);
