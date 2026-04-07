import { surveySchemaAPI } from "../../modules/survey/survey.schema";
import {
  CreateParticipantSchemaAPI,
  googleAuthSchemaAPI,
  loginParticipantSchemaAPI,
  ParticipantSchemaAPI,
  resetPasswordSchemaAPI,
  sendOtpSchemaAPI,
  verifyOtpSchemaAPI,
} from "../../modules/user/schemas/participant.schema";
import {
  CreateResearcherSchemaAPI,
  loginResearcherSchemaAPI,
  ResearcherSchemaAPI,
} from "../../modules/user/schemas/researcher.schema";

export const allSwaggerSchema = {
  // Participants
  Participant: ParticipantSchemaAPI,
  CreateParticipant: CreateParticipantSchemaAPI,
  LoginParticipant: loginParticipantSchemaAPI,
  GoogleAuthParticipant: googleAuthSchemaAPI,
  SendOtpParticipant: sendOtpSchemaAPI,
  VerifyOtpParticipant: verifyOtpSchemaAPI,
  ResetPasswordParticipant: resetPasswordSchemaAPI,

  //   Researchers
  Researcher: ResearcherSchemaAPI,
  CreateResearcher: CreateResearcherSchemaAPI,
  LoginResearcher: loginResearcherSchemaAPI,


  //   Survey
  Survey: surveySchemaAPI
};
