import mongoose from "mongoose";

const participantProfileSchema = new mongoose.Schema(
  {
    // Link to the User model
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required to create a profile"],
      unique: true,
    },
    
    // Identity & Demographics
    gender: { type: String, required: true },
    ethnic: { type: String, required: true },
    educationLevel: { type: String, required: true },
    isStudent: { type: String, required: true },
    
    // Date of Birth (Formatted & Raw parts)
    // dateOfBirth: { type: String, required: true }, 
    dob_day: { type: String, required: true },
    dob_month: { type: String, required: true },
    dob_year: { type: String, required: true },
    
    // Language & Communication
    firstLanguage: { type: String, required: true },
    fluentLanguage: { type: String, required: true },
    dialect: { type: String, required: true }, 
    
    // Geography & Origins
    countryOfBirth: { type: String, required: true },
    countryOfResidence: { type: String, required: true },
    pob: { type: String, required: true }, 
    mostLifeTime: { type: String, required: true }, 
    mostTimeSpent: { type: String, required: true }, 
    
    // Work & Finance
    currency: { type: String, required: true, default: "$(US)" },
    payPerHour: { type: String, required: true },
    workHour: { type: String, required: true },
    shareLinkedin: { type: String, required: true, default: "NO" },
    employmentStatus: {type: String, required: true},
    status: {type: String, enum: ['completed', 'pending'], default: 'pending'}
  },
  { timestamps: true }
);

// Changed "Profile" to "ParticipantProfile" in the check to match your model name
const ParticipantProfileModel = mongoose.model("ParticipantProfile", participantProfileSchema);

export default ParticipantProfileModel;
