"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParticipantService = void 0;
const emailService_1 = __importDefault(require("../../../shared/services/emailService"));
const apiResponse_1 = require("../../../utils/apiResponse");
const participant_repository_1 = require("../repositories/participant.repository");
const crypto_1 = __importDefault(require("crypto"));
const firebaseAdmin_1 = __importDefault(require("../../../firebaseAdmin"));
const participant_profile_repository_1 = require("../repositories/participant.profile.repository");
const jwt_1 = require("../../../utils/jwt");
const config_1 = require("../../../config");
const helper_1 = require("../../../utils/helper");
const researcher_repository_1 = require("../repositories/researcher.repository");
const participantRepo = new participant_repository_1.ParticipantRepository();
const researcherRepo = new researcher_repository_1.ResearcherRepository();
const participantProfileRepo = new participant_profile_repository_1.ParticipantProfileRepository();
class ParticipantService {
    async createUser(data) {
        try {
            let user = await participantRepo.findByEmail(data.email);
            const researcherUser = await researcherRepo.findByEmail(data.email);
            if (researcherUser) {
                return (0, apiResponse_1.serviceResponse)(false, "User already exists");
            }
            if (user && user.isVerified) {
                return (0, apiResponse_1.serviceResponse)(false, "User already exists");
            }
            const verificationToken = crypto_1.default.randomBytes(32).toString("hex");
            const verificationTokenExpires = new Date(Date.now() + 15 * 60 * 1000);
            if (user && !user.isVerified) {
                user.password = data.password;
                user.firstName = data.firstName;
                user.lastName = data.lastName;
                user.verificationToken = verificationToken;
                user.verificationTokenExpires = verificationTokenExpires;
                user.save();
            }
            else {
                user = await participantRepo.create({
                    ...data,
                    verificationToken,
                    verificationTokenExpires,
                });
            }
            const baseFrontendUrl = config_1.env.FRONTEND_BASE_URL || "";
            const verificationUrl = `${baseFrontendUrl}/auth/verify-email?token=${verificationToken}&email=${encodeURIComponent(data.email)}`;
            const emailHtml = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; padding: 30px; text-align: center;">
            <h1 style="color: #111827; font-size: 24px; margin-bottom: 10px;">Verify Your Email</h1>
            <p style="color: #4b5563; font-size: 16px;">Hi <strong>${data.firstName}</strong>,</p>
            <p style="color: #6b7280; line-height: 1.6;">
              Welcome! Please click the button below to verify your email address and activate your account.
            </p>
            
            <div style="margin: 30px 0;">
              <a href="${verificationUrl}" 
                style="background-color: #facc15; color: #000; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
                Verify Email Address
              </a>
            </div>

            <p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">
              This link will expire in <strong>15 minutes</strong>. <br/>
              If you did not create an account, you can safely ignore this email.
            </p>
            
            <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 25px 0;" />
            
            <p style="color: #9ca3af; font-size: 11px;">
              If the button above doesn't work, copy and paste this link into your browser: <br/>
              <span style="color: #3b82f6;">${verificationUrl}</span>
            </p>
          </div>
        `;
            // Send email
            if (data.signupPlatform === "email") {
                await (0, emailService_1.default)({
                    subject: "Verify Your Email",
                    to: data.email,
                    html: emailHtml,
                });
            }
            return (0, apiResponse_1.serviceResponse)(true, "User created. Verification email sent.", user);
        }
        catch (error) {
            console.log(error, "the get user");
            return (0, apiResponse_1.serviceResponse)(false, "Something went wrong. Please try again later");
        }
    }
    async loginUser(data) {
        try {
            const userExists = await participantRepo.findByEmail(data.email);
            if (!userExists) {
                return (0, apiResponse_1.serviceResponse)(false, "You are not registered. Please register");
            }
            if (userExists.signupPlatform === "google") {
                // If the user signed up via Google, prevent local login attempt
                if (data.password) {
                    return (0, apiResponse_1.serviceResponse)(false, "This account was created using Google. Please log in using Google.");
                }
            }
            if (!userExists.isVerified) {
                const verificationToken = crypto_1.default.randomBytes(32).toString("hex");
                const verificationTokenExpires = new Date(Date.now() + 15 * 60 * 1000);
                (userExists.verificationToken = verificationToken),
                    (userExists.verificationTokenExpires = verificationTokenExpires);
                const baseFrontendUrl = config_1.env.FRONTEND_BASE_URL || "";
                const verificationUrl = `${baseFrontendUrl}/auth/verify-email?token=${verificationToken}&email=${encodeURIComponent(data.email)}`;
                const emailHtml = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; padding: 30px; text-align: center;">
              <h1 style="color: #111827; font-size: 24px; margin-bottom: 10px;">Verify Your Email</h1>
              <p style="color: #4b5563; font-size: 16px;">Hi <strong>${data.email}</strong>,</p>
              <p style="color: #6b7280; line-height: 1.6;">
                Welcome! Please click the button below to verify your email address and activate your account.
              </p>
              
              <div style="margin: 30px 0;">
                <a href="${verificationUrl}" 
                  style="background-color: #facc15; color: #000; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
                  Verify Email Address
                </a>
              </div>

              <p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">
                This link will expire in <strong>15 minutes</strong>. <br/>
                If you did not create an account, you can safely ignore this email.
              </p>
              
              <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 25px 0;" />
              
              <p style="color: #9ca3af; font-size: 11px;">
                If the button above doesn't work, copy and paste this link into your browser: <br/>
                <span style="color: #3b82f6;">${verificationUrl}</span>
              </p>
            </div>
          `;
                // Send email
                await (0, emailService_1.default)({
                    subject: "Verify Your Email",
                    to: data.email,
                    html: emailHtml,
                });
                return (0, apiResponse_1.serviceResponse)(false, "User is not verified. An email has been sent to you");
            }
            if (!(await userExists.comparePassword(data.password))) {
                return (0, apiResponse_1.serviceResponse)(false, "Wrong email or password");
            }
            const accessToken = await userExists.generateAccessToken();
            const refreshToken = await userExists.generateRefreshToken();
            return (0, apiResponse_1.serviceResponse)(true, "Login Successful.", {
                user: userExists,
                accessToken: accessToken,
                refreshToken: refreshToken,
            });
        }
        catch (error) {
            console.log(error, "the get user");
            return (0, apiResponse_1.serviceResponse)(false, "Something went wrong. Please try again later");
        }
    }
    async verifyEmail(req) {
        try {
            const { token, email } = req.query;
            if (!token || !email) {
                return (0, apiResponse_1.serviceResponse)(false, "Invalid link. Please contact the administrator.");
            }
            const user = await participantRepo.findByEmail(email);
            if (!user) {
                return (0, apiResponse_1.serviceResponse)(false, "User not found.");
            }
            if (user.verificationToken !== token) {
                return (0, apiResponse_1.serviceResponse)(false, "Invalid or expired token");
            }
            if (!user.verificationTokenExpires ||
                user.verificationTokenExpires < new Date()) {
                return (0, apiResponse_1.serviceResponse)(false, "Verification token has expired");
            }
            // Mark user as verified
            user.isVerified = true;
            user.verificationToken = undefined;
            user.verificationTokenExpires = null;
            await user.save();
            return (0, apiResponse_1.serviceResponse)(true, "Email verified successfully", {
                redirectUrl: `${config_1.env.FRONTEND_BASE_URL}/waitlist?verified=true`,
            });
        }
        catch (error) {
            console.log(error, "the get user");
            return (0, apiResponse_1.serviceResponse)(false, "Something went wrong. Please try again later");
        }
    }
    async googleAuth(data) {
        try {
            const { token } = data;
            if (!token) {
                return (0, apiResponse_1.serviceResponse)(false, "Token is required");
            }
            const decodedToken = await firebaseAdmin_1.default.auth().verifyIdToken(token);
            const { email, name, picture, sub: googleId } = decodedToken;
            const newUser = {
                email,
                firstName: name.split(" ")[0] || "",
                lastName: name.split(" ")[1] || "",
                image: { imageUrl: picture, publicId: "" },
                googleId,
                signupPlatform: "google",
                isVerified: true,
            };
            let user = await participantRepo.findOne({
                $or: [{ googleId }, { email }],
            });
            if (!user) {
                user = await participantRepo.create(newUser);
                const accessToken = await user.generateAccessToken();
                const emailHtml = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; padding: 30px; text-align: center; background-color: #ffffff;">
              <div style="margin-bottom: 20px;">
                <div style="display: inline-block; width: 50px; height: 50px; background-color: #facc15; border-radius: 12px; line-height: 50px; font-weight: bold; font-size: 24px; color: #000;">
                  a
                </div>
              </div>
              
              <h1 style="color: #111827; font-size: 26px; margin-bottom: 10px;">Welcome to askField!</h1>
              <p style="color: #4b5563; font-size: 16px;">Hi <strong>${newUser.email}</strong>,</p>
              
              <p style="color: #6b7280; line-height: 1.6; margin-bottom: 25px;">
                Your registration was successful! We're excited to have you on board. You can now start exploring surveys, sharing your insights, and getting paid for your time.
              </p>
              
              <div style="margin: 30px 0;">
                <a href="${process.env.FRONTEND_URL}/dashboard" 
                  style="background-color: #facc15; color: #000; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                  Go to My Dashboard
                </a>
              </div>

              <p style="color: #4b5563; font-size: 14px; margin-top: 20px;">
                Need help getting started? Check out our <a href="${process.env.FRONTEND_URL}/support" style="color: #eab308; text-decoration: none; font-weight: 600;">Help Center</a> or reply to this email.
              </p>
              
              <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 30px 0;" />
              
              <p style="color: #9ca3af; font-size: 12px;">
                You received this email because you recently created a new account on askField.
              </p>
            </div>
          `;
                await (0, emailService_1.default)({
                    subject: "Welcome to Ask Field",
                    to: user.email,
                    html: emailHtml,
                });
                return (0, apiResponse_1.serviceResponse)(true, "Google authentication successful", {
                    token: accessToken,
                    user,
                });
            }
            else {
                // const refreshToken = await user.generateRefreshToken();
                const accessToken = await user.generateAccessToken();
                const refreshToken = await user.generateRefreshToken();
                return (0, apiResponse_1.serviceResponse)(true, "Google authentication successful", {
                    accessToken: accessToken,
                    user,
                    refreshToken,
                });
            }
        }
        catch (error) {
            console.error("Google authentication error:", error);
            return (0, apiResponse_1.serviceResponse)(false, "Google authentication failed");
        }
    }
    async getUser(req) {
        try {
            const userId = req.user?.id || "";
            if (!req.user || !req.user.id) {
                return (0, apiResponse_1.serviceResponse)(false, "Unauthorized: No user found in request");
            }
            const user = await participantRepo.findById(userId);
            if (!user)
                return (0, apiResponse_1.serviceResponse)(false, "User is not found");
            return (0, apiResponse_1.serviceResponse)(true, "User fetched successfully", user);
        }
        catch (error) {
            return (0, apiResponse_1.serviceResponse)(false, "Something went wrong. Please try again later");
        }
    }
    async completeProfile(req, data) {
        try {
            const userId = req.user?.id || "";
            const user = await participantRepo.findById(userId);
            if (!user) {
                return (0, apiResponse_1.serviceResponse)(false, "User does not exist");
            }
            const profileExists = await participantProfileRepo.findByUserId(userId);
            if (profileExists && profileExists.status == "completed") {
                return (0, apiResponse_1.serviceResponse)(true, "Your profile has already been completed");
            }
            const { gender, ethnic, educationLevel, isStudent, dob_day, dob_month, dob_year, firstLanguage, fluentLanguage, dialect, countryOfBirth, countryOfResidence, pob, mostTimeSpent, mostLifeTime, currency, payPerHour, workHour, shareLinkedin, employmentStatus, } = data;
            const newProfile = {
                userId,
                countryOfBirth,
                countryOfResidence,
                currency,
                dialect,
                dob_day,
                dob_month,
                dob_year,
                educationLevel,
                ethnic,
                firstLanguage,
                fluentLanguage,
                gender,
                isStudent,
                mostLifeTime,
                mostTimeSpent,
                payPerHour,
                pob,
                shareLinkedin,
                workHour,
                employmentStatus,
                status: "completed",
            };
            const createdProfile = await participantProfileRepo.create(newProfile);
            user.isCompleteProfile = true;
            await user.save();
            return (0, apiResponse_1.serviceResponse)(true, "Profile Completed Successfully", {
                profile: createdProfile,
            });
        }
        catch (error) {
            console.log(error);
            return (0, apiResponse_1.serviceResponse)(false, "Something went wrong. Please try again later");
        }
    }
    async getRefreshToken(req) {
        try {
            const refreshToken = req.header("token");
            if (!refreshToken) {
                return (0, apiResponse_1.serviceResponse)(false, "No refresh token");
            }
            const decoded = (0, jwt_1.verifyRefreshToken)(refreshToken);
            const { iat, exp, ...payload } = decoded;
            const newAccessToken = (0, jwt_1.signAccessToken)(payload);
            return (0, apiResponse_1.serviceResponse)(true, "Token verified", {
                accessToken: newAccessToken,
            });
        }
        catch (err) {
            console.log(err, "the err");
            return (0, apiResponse_1.serviceResponse)(false, "Invalid refresh token");
        }
    }
    async sendOtp(req) {
        try {
            const email = req.body.email || "";
            if (!email) {
                return (0, apiResponse_1.serviceResponse)(false, "Please provide an email");
            }
            const user = await participantRepo.findOne({ email });
            if (!user) {
                return (0, apiResponse_1.serviceResponse)(false, "User does not exist");
            }
            const otp = (0, helper_1.generateOTP)();
            const otpExpires = new Date(Date.now() + 15 * 60 * 1000);
            user.otp = otp;
            user.otpExpires = otpExpires;
            await user.save();
            const emailHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px;">
          <h1 style="color: #111827; font-size: 24px;">Reset Your Password</h1>
          <p style="color: #4b5563; font-size: 16px;">Hi <strong>${user.email}</strong>,</p>
          <p style="color: #4b5563; line-height: 1.5;">
            We received a request to reset your password. Use the verification code below to proceed. 
            <strong>This code expires in 10 minutes.</strong>
          </p>
          
          <div style="background-color: #fef9c3; border: 1px dashed #facc15; border-radius: 8px; padding: 20px; text-align: center; margin: 25px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #854d0e;">
              ${otp}
            </span>
          </div>

          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">
            If you did not request a password reset, please ignore this email or contact support if you have concerns.
          </p>
        </div>
    `;
            await (0, emailService_1.default)({
                subject: "Forgot Password Reset",
                to: user.email,
                html: emailHtml,
            });
            return (0, apiResponse_1.serviceResponse)(true, "Email has been sent to your email");
        }
        catch (error) {
            return (0, apiResponse_1.serviceResponse)(false, "Something went wrong. Please try again later");
        }
    }
    async verifyOtp(req) {
        try {
            const { code, email } = req.body;
            const user = await participantRepo.findByEmail(email);
            if (!user) {
                return (0, apiResponse_1.serviceResponse)(false, "User not found");
            }
            if (!user.otp) {
                return (0, apiResponse_1.serviceResponse)(false, "Try generating a new OTP.");
            }
            if (user.otp !== code) {
                return (0, apiResponse_1.serviceResponse)(false, "Wrong otp. Please try again later");
            }
            if (!user.otpExpires ||
                user.otpExpires < new Date()) {
                return (0, apiResponse_1.serviceResponse)(false, "OTP has expired. Please try again later.");
            }
            user.otp = undefined;
            user.otpExpires = null;
            const verificationToken = crypto_1.default.randomBytes(32).toString("hex");
            const verificationTokenExpires = new Date(Date.now() + 15 * 60 * 1000);
            user.verificationToken = verificationToken;
            user.verificationTokenExpires = verificationTokenExpires;
            await user.save();
            return (0, apiResponse_1.serviceResponse)(true, "OTP verified. Please proceed to reset your password", { token: verificationToken });
        }
        catch (error) {
            return (0, apiResponse_1.serviceResponse)(false, "Something went wrong. Please try again later");
        }
    }
    async resetPassword(req) {
        try {
            const { password, token, email } = req.body;
            if (!email) {
                return (0, apiResponse_1.serviceResponse)(false, "Email is invalid.");
            }
            if (!token) {
                return (0, apiResponse_1.serviceResponse)(false, "Token is invalid.");
            }
            const user = await participantRepo.findByEmail(email);
            if (!user) {
                return (0, apiResponse_1.serviceResponse)(false, "User not found");
            }
            if (!user.verificationToken) {
                return (0, apiResponse_1.serviceResponse)(false, "Seems you have used this token. Consider restarting the process");
            }
            if (user.verificationToken !== token) {
                return (0, apiResponse_1.serviceResponse)(false, "Invalid or expired token");
            }
            if (!user.verificationTokenExpires ||
                user.verificationTokenExpires < new Date()) {
                return (0, apiResponse_1.serviceResponse)(false, "Verification token has expired");
            }
            user.verificationToken = undefined;
            user.verificationTokenExpires = null;
            user.password = password;
            await user.save();
            return (0, apiResponse_1.serviceResponse)(true, "OTP verified. Please proceed to reset your password");
        }
        catch (error) {
            return (0, apiResponse_1.serviceResponse)(false, "Something went wrong. Please try again later");
        }
    }
}
exports.ParticipantService = ParticipantService;
