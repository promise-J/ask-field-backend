"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParticipantModel = void 0;
const mongoose_1 = require("mongoose");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const participantSchema = new mongoose_1.Schema({
    email: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true, trim: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    isVerified: { type: Boolean, default: false },
    isOnBoardingComplete: { type: Boolean, default: false },
    receivesUpdates: { type: Boolean, default: false },
}, { timestamps: true });
participantSchema.pre("save", async function (next) {
    try {
        if (this.isModified("password")) {
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
participantSchema.methods.comparePassword = async function (password) {
    const user = this;
    // console.log({password, userPassword: user.password})
    if (!password || !user.password) {
        throw new Error("Missing password or hash for comparison");
    }
    return await bcrypt_1.default.compare(password, user.password);
};
participantSchema.methods.isSubscriptionActive = function () {
    return (this.subscriptionStatus === "active" && new Date() < this.subscriptionExpiry);
};
participantSchema.methods.generateAccessToken = async function (secretToken) {
    const token = jsonwebtoken_1.default.sign({
        id: this._id,
        userType: this.userType,
    }, secretToken, { expiresIn: "1h" });
    return token;
};
participantSchema.methods.generateRefreshToken = async function (secretToken) {
    const token = jsonwebtoken_1.default.sign({
        id: this._id,
        userType: this.userType,
    }, secretToken, { expiresIn: "4w" });
    return token;
};
exports.ParticipantModel = (0, mongoose_1.model)('Participant', participantSchema);
