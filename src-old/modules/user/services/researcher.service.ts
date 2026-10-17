import crypto from "crypto";
import { ResearcherRepository } from "../repositories/researcher.repository";
import { serviceResponse } from "../../../utils/apiResponse";
import { ParticipantRepository } from "../repositories/participant.repository";
import sendEmail from "../../../shared/services/emailService";
import { env } from "../../../config";
import { Request } from "express";

const researcherRepo = new ResearcherRepository();
const participantRepo = new ParticipantRepository();

type CreateUserReq = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  signupPlatform: string;
};

interface SurveyResponse {
  activeSurveys: number;
  liveSurveys: number;
  draftSurveys: number;
  closedSurveys: number;
  researchSpent: number;
}

export class ResearcherService {
  async createUser(data: CreateUserReq) {
    try {
      let user = await researcherRepo.findByEmail(data.email);
      const participantExists = await participantRepo.findByEmail(data.email);

      
      if (user) {
        return serviceResponse(false, "User exists already. Try another email");
      }
      if (participantExists) {
        return serviceResponse(false, "User exists already. Try another email");
      }

      const verificationToken = crypto.randomBytes(32).toString("hex");
      const verificationTokenExpires = new Date(Date.now() + 15 * 60 * 1000);

        user = await researcherRepo.create({
          ...data,
          verificationToken,
          verificationTokenExpires,
        });
    

      const baseFrontendUrl = env.FRONTEND_BASE_URL || "";
      const verificationUrl = `${baseFrontendUrl}/auth/researcher/verify-email?token=${verificationToken}&email=${encodeURIComponent(
        data.email
      )}`;

      const emailHtml = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; padding: 30px; text-align: center;">
            <h1 style="color: #111827; font-size: 24px; margin-bottom: 10px;">Verify Your Email</h1>
            <p style="color: #4b5563; font-size: 16px;">Hi <strong>${data.firstName}</strong>,</p>
            <p style="color: #6b7280; line-height: 1.6;">
              Welcome! Please click the button below to login to start creating surveys.
            </p>
            
            <div style="margin: 30px 0;">
              <a href="${verificationUrl}" 
                style="background-color: #facc15; color: #000; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
                Continue Here
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
      await sendEmail({
        subject: "Welcome to Ask Field",
        to: data.email,
        html: emailHtml,
      });

      return serviceResponse(
        true,
        "Welcome. We have sent a login link to this email",
        user
      );
    } catch (error) {
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      );
    }
  }
  async loginUser(data: any) {
    try {
      const userExists = await researcherRepo.findByEmail(data.email);
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

        const baseFrontendUrl = env.FRONTEND_BASE_URL || "";
        const verificationUrl = `${baseFrontendUrl}/auth/researcher/verify-email?token=${verificationToken}&email=${encodeURIComponent(
          data.email
        )}`;

        const emailHtml = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; padding: 30px; text-align: center;">
            <h1 style="color: #111827; font-size: 24px; margin-bottom: 10px;">Verify Your Email</h1>
            <p style="color: #4b5563; font-size: 16px;">Hi <strong>${data.firstName}</strong>,</p>
            <p style="color: #6b7280; line-height: 1.6;">
              Welcome! Please click the button below to login to start creating surveys.
            </p>
            
            <div style="margin: 30px 0;">
              <a href="${verificationUrl}" 
                style="background-color: #facc15; color: #000; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
                Continue Here
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

        await sendEmail({
          subject: "Welcome to Ask",
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

        console.log(req.query)
  
        const user = await researcherRepo.findByEmail(email as string);
  
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
          redirectUrl: `${env.FRONTEND_BASE_URL}/auth/login/researcher`,
        });
      } catch (error) {
        console.log(error, "the get user");
        return serviceResponse(
          false,
          "Something went wrong. Please try again later"
        );
      }
    }

  async getUser(req: Request) {
     try {
       const userId = req.user?.id || "";
 
       if (!req.user || !req.user.id) {
         return serviceResponse(false, "Unauthorized: No user found in request");
       }
 
       const user = await researcherRepo.findById(userId);
       if (!user) return serviceResponse(false, "User is not found");
       return serviceResponse(true, "User fetched successfully", user);
     } catch (error) {
       return serviceResponse(
         false,
         "Something went wrong. Please try again later"
       );
     }
   }
  async researcherDashboardStats(req: Request) {
     try {
       const userId = req.user?.id || "";
 
       if (!req.user || !req.user.id) {
         return serviceResponse(false, "Unauthorized: No user found in request");
       }
 
       const user = await researcherRepo.findById(userId);
       if (!user) return serviceResponse(false, "User is not found");

      
      const response = {} as SurveyResponse; 

       response['activeSurveys'] = 120;
       response['liveSurveys'] = 30;
       response['draftSurveys'] = 60;
       response['closedSurveys'] = 30;
       response['researchSpent'] = 56700;

       return serviceResponse(true, "User fetched successfully", response);
     } catch (error) {
       return serviceResponse(
         false,
         "Something went wrong. Please try again later"
       );
     }
   }
}
