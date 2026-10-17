
export const CreateParticipantSchemaAPI = {
  type: "object",
  properties: {
    email: { type: "string", format: "email" },
    password: { type: "string", minLength: 8 },
    firstName: { type: "string" },
    lastName: { type: "string", minLength: 5 },
    signupPlatform: {
      type: "string",
      enum: ["email", "google"],
      default: "email",
    },
    receivesUpdates: { type: "boolean", default: false },
  },
  required: ["email", "password", "firstName", "lastName"],
};

export const loginParticipantSchemaAPI = {
  type: "object",
  properties: {
    email: { type: "string", format: "email" },
    password: { type: "string", minLength: 8 },
  },
  required: ["email", "password"],
};

export const ParticipantSchemaAPI = {
  type: "object",
  properties: {
    email: { type: "string", format: "email" },
    password: { type: "string", minLength: 8 }, // only for creation, hashed in DB
    firstName: { type: "string" },
    lastName: { type: "string" },
    isVerified: { type: "boolean", default: false },
    verificationToken: { type: "string" },
    verificationTokenExpires: {
      type: "string",
      format: "date-time",
      nullable: true,
    },
    otp: { type: "string" },
    otpExpires: { type: "string", format: "date-time", nullable: true },
    signupPlatform: {
      type: "string",
      enum: ["email", "google"],
      default: "email",
    },
    receivesUpdates: { type: "boolean", default: false },
    googleId: { type: "string" },
    userType: { type: "string", default: "participant" },
    subscriptionStatus: { type: "string" },
    subscriptionExpiry: { type: "string", format: "date-time", nullable: true },
    isCompleteProfile: { type: "boolean", default: false },
    image: {
      type: "object",
      properties: {
        imageUrl: { type: "string" },
        publicId: { type: "string" },
      },
      required: [],
    },
  },
  required: [
    "email",
    "firstName",
    "lastName",
    "signupPlatform",
    "receivesUpdates",
  ],
};

export const verifyEmailSchemaAPI = {
  type: "object",
  properties: {
    email: { type: "string", format: "email" },
    token: { type: "string", minLength: 20 },
  },
  required: ["email", "token"],
};

export const googleAuthSchemaAPI = {
    type: "object",
    properties: {
      token: { type: "string", minLength: 10 },
    },
    required: ["token"],
  };
  
  export const sendOtpSchemaAPI = {
    type: "object",
    properties: {
      email: { type: "string", format: "email" },
    },
    required: ["email"],
  };
  
  export const verifyOtpSchemaAPI = {
    type: "object",
    properties: {
      email: { type: "string", format: "email" },
      code: { type: "string", minLength: 6 },
    },
    required: ["email", "code"],
  };
  
  export const resetPasswordSchemaAPI = {
    type: "object",
    properties: {
      password: { type: "string", minLength: 8 },
      email: { type: "string", format: "email" },
      token: { type: "string", minLength: 10 },
    },
    required: ["password", "email", "token"],
  };
  
  export const completeProfileSchemaAPI = {
    type: "object",
    properties: {
      gender: { type: "string", minLength: 1 },
      ethnic: { type: "string", minLength: 1 },
      educationLevel: { type: "string", minLength: 1 },
      isStudent: { type: "string", minLength: 1 },
      dob_day: { type: "string", minLength: 1 },
      dob_month: { type: "string", minLength: 1 },
      dob_year: { type: "string", minLength: 1 },
      firstLanguage: { type: "string", minLength: 1 },
      fluentLanguage: { type: "string", minLength: 1 },
      dialect: { type: "string", minLength: 1 },
      countryOfBirth: { type: "string", minLength: 1 },
      countryOfResidence: { type: "string", minLength: 1 },
      pob: { type: "string", minLength: 1 },
      mostLifeTime: { type: "string", minLength: 1 },
      mostTimeSpent: { type: "string", minLength: 1 },
      currency: { type: "string", minLength: 1 },
      payPerHour: { type: "string", minLength: 1 },
      workHour: { type: "string", minLength: 1 },
      shareLinkedin: { type: "string", minLength: 1 },
    },
    required: [
      "gender",
      "ethnic",
      "educationLevel",
      "isStudent",
      "dob_day",
      "dob_month",
      "dob_year",
      "firstLanguage",
      "fluentLanguage",
      "dialect",
      "countryOfBirth",
      "countryOfResidence",
      "pob",
      "mostLifeTime",
      "mostTimeSpent",
      "currency",
      "payPerHour",
      "workHour",
      "shareLinkedin",
    ],
  };