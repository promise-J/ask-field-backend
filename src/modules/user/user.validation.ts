import { z } from 'zod';

export const createParticipantSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().nonempty('First name is required'),
  lastName: z.string().min(5),
  signupPlatform: z.enum(['email', 'google']).default('email'),
  receivesUpdates: z.boolean().default(false),
});
export const loginParticipantSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});


export const verifyEmailQuerySchema = z.object({
  email: z.string().email(),
  token: z.string().min(20, "Invalid token"), // adjust min length based on your token generation
});

export const googleAuthSchema = z.object({
  token: z.string().min(10, "Invalid token"),
})

export const sendOtpSchema = z.object({
  email: z.string().email(),
})
export const verifyOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().min(6, "Invalid token"),
})
export const resetPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  email: z.string().email(),
  token: z.string().min(10, "Invalid token"), // adjust min length based on your token generation
})

export const completeProfileSchema = z.object({
  gender: z.string().min(1, "Gender is required"),
  ethnic: z.string().min(1, "Ethnicity is required"),
  educationLevel: z.string().min(1, "Education level is required"),
  isStudent: z.string().min(1, "Student status is required"),
  dob_day: z.string().min(1, "Day is required"),
  dob_month: z.string().min(1, "Month is required"),
  dob_year: z.string().min(1, "Year is required"),
  firstLanguage: z.string().min(1, "First language is required"),
  fluentLanguage: z.string().min(1, "Fluent language is required"),
  dialect: z.string().min(1, "Dialect is required"),
  countryOfBirth: z.string().min(1, "Country of birth is required"),
  countryOfResidence: z.string().min(1, "Country of residence is required"),
  pob: z.string().min(1, "Place of birth is required"),
  mostLifeTime: z.string().min(1, "This field is required"),
  mostTimeSpent: z.string().min(1, "This field is required"),
  currency: z.string().min(1, "Currency is required"),
  payPerHour: z.string().min(1, "Pay per hour is required"),
  workHour: z.string().min(1, "Work hours are required"),
  shareLinkedin: z.string().min(1, "LinkedIn preference is required"),
});