import { CreateProjectSchemaAPI, ProjectSchemaAPI } from "../../modules/project/project.schema";
import { createDraftSurveySchemaAPI, surveySchemaAPI } from "../../modules/survey/survey.schema";
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
  dashboardStatsSchemaAPI,
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
  DashboardStats: dashboardStatsSchemaAPI,


  //   Survey
  Survey: surveySchemaAPI,
  CreateDraftSurvey: createDraftSurveySchemaAPI,

  //   Projects
  Project: ProjectSchemaAPI,
  CreateProject: CreateProjectSchemaAPI,
};
