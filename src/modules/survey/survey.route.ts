import { Router } from "express";

import { validate } from "../../middlewares/validate";
import {
  ROUTE_APPROVE_SURVEY_ACTION,
  ROUTE_CHECK_ELIGIBILITY_SURVEY_ID,
  ROUTE_CREATE_DRAFT_SURVEY,
  ROUTE_CREATE_SURVEY,
  ROUTE_CREATE_SURVEY_ACTION,
  ROUTE_GET_ALL_SURVEYS,
  ROUTE_GET_SURVEY_ACTION_BY_ID,
  ROUTE_GET_SURVEY_ACTION_BY_SURVEY_ID,
  ROUTE_GET_SURVEYS_BY_PROJECT_ID,
  ROUTE_GET_USER_SURVEY_ID,
  ROUTE_LIST_SURVEY_ACTIONS,
  ROUTE_PUBLISH_DRAFT_SURVEY,
  ROUTE_REJECT_SURVEY_ACTION,
  ROUTE_UPDATE_DRAFT_SURVEY,
  ROUTE_VERIRY_SURVEY_ACTION,
} from "../../utils/page-routes";

import { createDraftSurveySchema, createSurveySchema } from "./survey.validation";
import { approveSurveyAction, checkEligibility, createDraftSurvey, createSurvey, createSurveyAction, getAllSurveys, getSurveyActionById, getSurveyActionBySurveyId, getSurveysByProjectId, getUserSurveyById, listSurveyActions, publishSurvey, rejectSurveyAction, updateDraftSurvey, verifySurveyAction } from "./survey.controller";
import researcherAuth from "../../middlewares/auth/auth.researcher.middleware";
import participantAuth from "../../middlewares/auth/auth.participant.middleware";
import { authMiddleware } from "../../middlewares/auth/auth.middleware";

const router = Router();

router.post(ROUTE_CREATE_DRAFT_SURVEY, validate(createDraftSurveySchema), researcherAuth, createDraftSurvey);
router.put(ROUTE_UPDATE_DRAFT_SURVEY, researcherAuth, updateDraftSurvey);
router.post(ROUTE_PUBLISH_DRAFT_SURVEY, researcherAuth, publishSurvey);

router.post(ROUTE_CREATE_SURVEY, validate(createSurveySchema), researcherAuth, createSurvey);
router.get(ROUTE_GET_SURVEYS_BY_PROJECT_ID, researcherAuth, getSurveysByProjectId);
router.get(ROUTE_GET_ALL_SURVEYS, authMiddleware, getAllSurveys);
router.get(ROUTE_GET_USER_SURVEY_ID, authMiddleware, getUserSurveyById);
router.get(ROUTE_CHECK_ELIGIBILITY_SURVEY_ID, participantAuth, checkEligibility);


router.post(ROUTE_CREATE_SURVEY_ACTION, researcherAuth, createSurveyAction);
router.get(ROUTE_VERIRY_SURVEY_ACTION, participantAuth, verifySurveyAction)
router.put(ROUTE_APPROVE_SURVEY_ACTION, researcherAuth, approveSurveyAction);
router.put(ROUTE_REJECT_SURVEY_ACTION, researcherAuth, rejectSurveyAction);
router.get(ROUTE_GET_SURVEY_ACTION_BY_ID, authMiddleware, getSurveyActionById);
router.get(ROUTE_GET_SURVEY_ACTION_BY_SURVEY_ID, authMiddleware, getSurveyActionBySurveyId);
router.get(ROUTE_LIST_SURVEY_ACTIONS, researcherAuth, listSurveyActions)




export default router;
