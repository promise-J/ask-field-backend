import { Request } from "express";
import sendEmail from "../../../shared/services/emailService";
import { serviceResponse } from "../../../utils/apiResponse";
import { ParticipantRepository } from "../repositories/participant.repository";
import crypto from "crypto";
import admin from "../../../firebaseAdmin";
import { ParticipantProfileRepository } from "../repositories/participant.profile.repository";
import { signAccessToken, verifyRefreshToken } from "../../../utils/jwt";
import { JwtPayload } from "jsonwebtoken";

type LoginUserReq = { email: string; password: string };

type CreateUserReq = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  signupPlatform: string;
};

type CompleteProfileReq = {
  gender: string;
  ethnic: string;
  educationLevel: string;
  isStudent: string;
  dob_day: string;
  dob_month: string;
  dob_year: string;
  firstLanguage: string;
  fluentLanguage: string;
  dialect: string;
  countryOfBirth: string;
  countryOfResidence: string;
  pob: string;
  mostLifeTime: string;
  mostTimeSpent: string;
  currency: string;
  payPerHour: string;
  workHour: string;
  shareLinkedin: string;
  employmentStatus: string;
};

const participantRepo = new ParticipantRepository();
const participantProfileRepo = new ParticipantProfileRepository();

export class ParticipantService {
  async createUser(data: CreateUserReq) {
    try {
      let user = await participantRepo.findByEmail(data.email);

      if (user && user.isVerified) {
        return serviceResponse(false, "User already exists");
      }

      const verificationToken = crypto.randomBytes(32).toString("hex");
      const verificationTokenExpires = new Date(Date.now() + 15 * 60 * 1000);

      if (user && !user.isVerified) {
        user.password = data.password;
        user.firstName = data.firstName;
        user.lastName = data.lastName;
        user.verificationToken = verificationToken;
        user.verificationTokenExpires = verificationTokenExpires;
        user.save();
      } else {
        user = await participantRepo.create({
          ...data,
          verificationToken,
          verificationTokenExpires,
        });
      }

      const baseFrontendUrl = process.env.FRONTEND_BASE_URL || "";
      const verificationUrl = `${baseFrontendUrl}/auth/verify-email?token=${verificationToken}&email=${encodeURIComponent(
        data.email
      )}`;

      const emailHtml = `
    <h1>Verify Your Email</h1>
    <p>Hi <strong>${data.email}</strong>,</p>
    <p>Click the link below to verify your email:</p>
    <a href="${verificationUrl}">Verify Email</a>
    <p>This link expires in 15 minutes.</p>
  `;

      // Send email
      if (data.signupPlatform === "email") {
        await sendEmail({
          subject: "Verify Your Email",
          to: data.email,
          html: emailHtml,
        });
      }

      return serviceResponse(
        true,
        "User created. Verification email sent.",
        user
      );
    } catch (error) {
      console.log(error, "the get user");
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      );
    }
  }
  async loginUser(data: LoginUserReq) {
    try {
      const userExists = await participantRepo.findByEmail(data.email);
      if (!userExists) {
        return serviceResponse(
          false,
          "You are not registered. Please register"
        );
      }

      if (userExists.signupPlatform === "google") {
        // If the user signed up via Google, prevent local login attempt
        if (data.password) {
          return serviceResponse(
            false,
            "This account was created using Google. Please log in using Google."
          );
        }
      }

      if (!userExists.isVerified) {
        const verificationToken = crypto.randomBytes(32).toString("hex");
        const verificationTokenExpires = new Date(Date.now() + 15 * 60 * 1000);

        (userExists.verificationToken = verificationToken),
          (userExists.verificationTokenExpires = verificationTokenExpires);

        const baseFrontendUrl = process.env.FRONTEND_BASE_URL || "";
        const verificationUrl = `${baseFrontendUrl}/auth/verify-email?token=${verificationToken}&email=${encodeURIComponent(
          data.email
        )}`;

        const emailHtml = `
    <h1>Verify Your Email</h1>
    <p>Hi <strong>${data.email}</strong>,</p>
    <p>Click the link below to verify your email:</p>
    <a href="${verificationUrl}">Verify Email</a>
    <p>This link expires in 15 minutes.</p>
  `;

        // Send email

        await sendEmail({
          subject: "Verify Your Email",
          to: data.email,
          html: emailHtml,
        });

        return serviceResponse(
          false,
          "User is not verified. An email has been sent to you"
        );
      }

      if (!(await userExists.comparePassword(data.password))) {
        return serviceResponse(false, "Wrong email or password");
      }

      const accessToken = await userExists.generateAccessToken();
      const refreshToken = await userExists.generateRefreshToken();

      return serviceResponse(true, "Login Successful.", {
        user: userExists,
        accessToken: accessToken,
        refreshToken: refreshToken,
      });
    } catch (error) {
      console.log(error, "the get user");
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      );
    }
  }
  async verifyEmail(req: Request) {
    try {
      const { token, email } = req.query;

      if (!token || !email) {
        return serviceResponse(
          false,
          "Invalid link. Please contact the administrator."
        );
      }

      const user = await participantRepo.findByEmail(email as string);

      if (!user) {
        return serviceResponse(false, "User not found.");
      }

      if (user.verificationToken !== token) {
        return serviceResponse(false, "Invalid or expired token");
      }

      if (
        !user.verificationTokenExpires ||
        user.verificationTokenExpires < new Date()
      ) {
        return serviceResponse(false, "Verification token has expired");
      }

      // Mark user as verified
      user.isVerified = true;
      user.verificationToken = undefined;
      user.verificationTokenExpires = null;

      await user.save();

      return serviceResponse(true, "Email verified successfully", {
        redirectUrl: `${process.env.FRONTEND_BASE_URL}/waitlist?verified=true`,
      });
    } catch (error) {
      console.log(error, "the get user");
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      );
    }
  }

  async googleAuth(data: { token: string }) {
    try {
      const { token } = data;

      if (!token) {
        return serviceResponse(false, "Token is required");
      }

      const decodedToken = await admin.auth().verifyIdToken(token);

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
        <h1>Registration successful</h1>
        <p>Hi <strong>${newUser.email}</strong>,</p>
        <p>You have successfully sign up:</p>
        `;
        await sendEmail({
          subject: "Welcome to Ask Field",
          to: user.email,
          html: emailHtml,
        });

        return serviceResponse(true, "Google authentication successful", {
          token: accessToken,
          user,
        });
      } else {
        // const refreshToken = await user.generateRefreshToken();
        const accessToken = await user.generateAccessToken();
        const refreshToken = await user.generateRefreshToken();

        return serviceResponse(true, "Google authentication successful", {
          accessToken: accessToken,
          user,
          refreshToken,
        });
      }
    } catch (error) {
      console.error("Google authentication error:", error);
      return serviceResponse(false, "Google authentication failed");
    }
  }

  async getUser(req: Request) {
    try {
      const userId = req.user?.id || "";

      if (!req.user || !req.user.id) {
        return serviceResponse(false, "Unauthorized: No user found in request");
      }

      const user = await participantRepo.findById(userId);
      if (!user) return serviceResponse(false, "User is not found");
      return serviceResponse(true, "User fetched successfully", user);
    } catch (error) {
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      );
    }
  }

  async completeProfile(req: Request, data: CompleteProfileReq) {
    try {
      const userId = req.user?.id || "";

      const user = await participantRepo.findById(userId)

      if(!user){
        return serviceResponse(false, "User does not exist")
      }

      const profileExists = await participantProfileRepo.findByUserId(userId);
      if (profileExists && profileExists.status == "completed") {
        return serviceResponse(true, "Your profile has already been completed");
      }

      const {
        gender,
        ethnic,
        educationLevel,
        isStudent,
        dob_day,
        dob_month,
        dob_year,
        firstLanguage,
        fluentLanguage,
        dialect,
        countryOfBirth,
        countryOfResidence,
        pob,
        mostTimeSpent,
        mostLifeTime,
        currency,
        payPerHour,
        workHour,
        shareLinkedin,
        employmentStatus
      } = data;

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
        status: 'completed'
      };

      const createdProfile = await participantProfileRepo.create(newProfile)

      user.isCompleteProfile = true;
      await user.save()

      return serviceResponse(true, "good to go", {profile: createdProfile});
    } catch (error) {
      console.log(error)
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      );
    }
  }

  async getRefreshToken(req: Request) {
    try {
      const refreshToken = req.header("token");

      if (!refreshToken) {
        return serviceResponse(false, "No refresh token");
      }

      const decoded = verifyRefreshToken(refreshToken) as JwtPayload;

      const { iat, exp, ...payload } = decoded;

      const newAccessToken = signAccessToken(payload);

      return serviceResponse(true, "Token verified", {
        accessToken: newAccessToken,
      });
    } catch (err) {
      console.log(err, "the err");
      return serviceResponse(false, "Invalid refresh token");
    }
  }
}
