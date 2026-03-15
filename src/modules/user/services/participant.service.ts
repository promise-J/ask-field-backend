import { Request } from "express";
import sendEmail from "../../../shared/services/emailService";
import { serviceResponse } from "../../../utils/apiResponse";
import { ParticipantRepository } from "../repositories/participant.repository";
import crypto from "crypto";
import admin from "../../../firebaseAdmin";

const participantRepo = new ParticipantRepository();

export class ParticipantService {
  async createUser(data: any) {
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
      user.save()
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
  }
  async loginUser(data: any) {
    const userExists = await participantRepo.findByEmail(data.email);
    if (!userExists) {
      return serviceResponse(false, "You are not registered. Please register");
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

    return serviceResponse(true, "Login Successful.", {
      user: userExists,
      token: accessToken,
    });
  }
  async verifyEmail(data: any, req: Request) {
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

        return serviceResponse(true, "Google authentication successful", {
          token: accessToken,
          user,
        });
      }
    } catch (error) {
      console.error("Google authentication error:", error);
      return serviceResponse(false, "Google authentication failed");
    }
  }

  async getUser(id: string) {
    const user = await participantRepo.findById(id);
    if (!user) throw new Error("User not found");
    return user;
  }
}
