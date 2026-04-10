"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginResearcherSchema = exports.createResearcherSchema = exports.completeProfileSchema = exports.resetPasswordSchema = exports.verifyOtpSchema = exports.sendOtpSchema = exports.googleAuthSchema = exports.verifyEmailQuerySchema = exports.loginParticipantSchema = exports.createParticipantSchema = void 0;
const zod_1 = require("zod");
//Participants
exports.createParticipantSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8, 'Password must be at least 8 characters'),
    firstName: zod_1.z.string().nonempty('First name is required'),
    lastName: zod_1.z.string().min(5),
    signupPlatform: zod_1.z.enum(['email', 'google']).default('email'),
    receivesUpdates: zod_1.z.boolean().default(false),
});
exports.loginParticipantSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8, 'Password must be at least 8 characters'),
});
exports.verifyEmailQuerySchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    token: zod_1.z.string().min(20, "Invalid token"), // adjust min length based on your token generation
});
exports.googleAuthSchema = zod_1.z.object({
    token: zod_1.z.string().min(10, "Invalid token"),
});
exports.sendOtpSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
});
exports.verifyOtpSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    code: zod_1.z.string().min(6, "Invalid token"),
});
exports.resetPasswordSchema = zod_1.z.object({
    password: zod_1.z.string().min(8, 'Password must be at least 8 characters'),
    email: zod_1.z.string().email(),
    token: zod_1.z.string().min(10, "Invalid token"), // adjust min length based on your token generation
});
exports.completeProfileSchema = zod_1.z.object({
    gender: zod_1.z.string().min(1, "Gender is required"),
    ethnic: zod_1.z.string().min(1, "Ethnicity is required"),
    educationLevel: zod_1.z.string().min(1, "Education level is required"),
    isStudent: zod_1.z.string().min(1, "Student status is required"),
    dob_day: zod_1.z.string().min(1, "Day is required"),
    dob_month: zod_1.z.string().min(1, "Month is required"),
    dob_year: zod_1.z.string().min(1, "Year is required"),
    firstLanguage: zod_1.z.string().min(1, "First language is required"),
    fluentLanguage: zod_1.z.string().min(1, "Fluent language is required"),
    dialect: zod_1.z.string().min(1, "Dialect is required"),
    countryOfBirth: zod_1.z.string().min(1, "Country of birth is required"),
    countryOfResidence: zod_1.z.string().min(1, "Country of residence is required"),
    pob: zod_1.z.string().min(1, "Place of birth is required"),
    mostLifeTime: zod_1.z.string().min(1, "This field is required"),
    mostTimeSpent: zod_1.z.string().min(1, "This field is required"),
    currency: zod_1.z.string().min(1, "Currency is required"),
    payPerHour: zod_1.z.string().min(1, "Pay per hour is required"),
    workHour: zod_1.z.string().min(1, "Work hours are required"),
    shareLinkedin: zod_1.z.string().min(1, "LinkedIn preference is required"),
});
//Researcher
exports.createResearcherSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8, 'Password must be at least 8 characters'),
    firstName: zod_1.z.string().nonempty('First name is required'),
    lastName: zod_1.z.string().min(5),
    signupPlatform: zod_1.z.enum(['email', 'google']).default('email'),
    jobTitle: zod_1.z.string().min(3),
    organizationType: zod_1.z.string().min(3),
    organizationName: zod_1.z.string().min(3),
    country: zod_1.z.string().min(3),
});
exports.loginResearcherSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8, 'Password must be at least 8 characters'),
});
