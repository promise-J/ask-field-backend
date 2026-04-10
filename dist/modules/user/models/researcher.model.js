"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResearcherModel = void 0;
const mongoose_1 = require("mongoose");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../../../config");
const researcherSchema = new mongoose_1.Schema({
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
    userType: { type: String, default: "participant" },
    jobTitle: { type: String },
    organizationType: { type: String },
    organizationName: { type: String },
    country: { type: String },
    image: {
        imageUrl: { type: String },
        publicId: { type: String },
    },
    isCompleteProfile: { type: Boolean, default: false },
}, { timestamps: true });
researcherSchema.pre("save", async function (next) {
    try {
        if (this.isModified("password") && this.password) {
            // const user = this as IUser;
            const hashPassword = await bcrypt_1.default.hash(this.password, 10);
            this.password = hashPassword;
        }
        // if (this.userType !== "coach") {
        //   this.isVerifiedCoach = undefined;
        // }
        next();
    }
    catch (error) {
        return next();
    }
});
researcherSchema.methods.comparePassword = async function (password) {
    const user = this;
    // console.log({password, userPassword: user.password})
    if (!password || !user.password) {
        throw new Error("Missing password or hash for comparison");
    }
    return await bcrypt_1.default.compare(password, user.password);
};
researcherSchema.methods.isSubscriptionActive = function () {
    return (this.subscriptionStatus === "active" && new Date() < this.subscriptionExpiry);
};
researcherSchema.methods.generateAccessToken = async function () {
    const token = jsonwebtoken_1.default.sign({
        id: this._id,
        userType: this.userType,
    }, config_1.env.ACCESS_SECRET || "", { expiresIn: "1h" });
    return token;
};
researcherSchema.methods.generateRefreshToken = async function () {
    const token = jsonwebtoken_1.default.sign({
        id: this._id,
        userType: this.userType,
    }, config_1.env.REFRESH_SECRET || "", { expiresIn: "1w" });
    return token;
};
exports.ResearcherModel = (0, mongoose_1.model)("Researcher", researcherSchema);
