import z from "zod";


export const ResearcherSchemaAPI = {
  type: 'object',
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 8 },
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    isVerified: { type: 'boolean', default: false },
    verificationToken: { type: 'string' },
    verificationTokenExpires: { type: 'string', format: 'date-time', nullable: true },
    otp: { type: 'string' },
    otpExpires: { type: 'string', format: 'date-time', nullable: true },
    signupPlatform: { type: 'string', enum: ['email', 'google'], default: 'email' },
    image: {
      type: 'object',
      properties: {
        imageUrl: { type: 'string', format: 'uri' },
        publicId: { type: 'string' },
      },
      required: [],
    },
    googleId: { type: 'string' },
    subscriptionStatus: { type: 'string' },
    subscriptionExpiry: { type: 'string', format: 'date-time' },
    userType: { type: 'string' },
    isCompleteProfile: { type: 'boolean', default: false },
    jobTitle: { type: 'string' },
    organizationType: { type: 'string' },
    organizationName: { type: 'string' },
    country: { type: 'string' },
  },
  required: [
    'email',
    'password',
    'firstName',
    'lastName',
    'isVerified',
    'signupPlatform',
    'isCompleteProfile',
    'jobTitle',
    'organizationType',
    'organizationName',
    'country',
  ],
};

export const CreateResearcherSchemaAPI = {
    type: 'object',
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 8 },
      firstName: { type: 'string' },
      lastName: { type: 'string', minLength: 5 },
      signupPlatform: { type: 'string', enum: ['email', 'google'], default: 'email' },
    },
    required: ['email', 'password', 'firstName', 'lastName'],
  };

export const loginResearcherSchemaAPI = {
  type: "object",
  properties: {
    email: { type: "string", format: "email" },
    password: { type: "string", minLength: 8 },
  },
  required: ["email", "password"],
};