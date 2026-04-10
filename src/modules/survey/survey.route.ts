import { Router } from "express";

import { validate } from "../../middlewares/validate";
import {
  ROUTE_CREATE_DRAFT_SURVEY,
  ROUTE_CREATE_SURVEY,
  ROUTE_GET_SURVEYS_BY_PROJECT_ID,
  ROUTE_GET_USER_SURVEY_ID,
  ROUTE_PUBLISH_DRAFT_SURVEY,
  ROUTE_UPDATE_DRAFT_SURVEY,
} from "../../utils/page-routes";

import { createDraftSurveySchema, createSurveySchema } from "./survey.validation";
import { createDraftSurvey, createSurvey, getSurveysByProjectId, getUserSurveyById, publishSurvey, updateDraftSurvey } from "./survey.controller";
import researcherAuth from "../../middlewares/auth/auth.researcher.middleware";

const router = Router();

router.post(ROUTE_CREATE_DRAFT_SURVEY, validate(createDraftSurveySchema), researcherAuth, createDraftSurvey);
router.put(ROUTE_UPDATE_DRAFT_SURVEY, researcherAuth, updateDraftSurvey);
router.post(ROUTE_PUBLISH_DRAFT_SURVEY, researcherAuth, publishSurvey);

router.post(ROUTE_CREATE_SURVEY, validate(createSurveySchema), researcherAuth, createSurvey);
router.get(ROUTE_GET_SURVEYS_BY_PROJECT_ID, researcherAuth, getSurveysByProjectId);
router.get(ROUTE_GET_USER_SURVEY_ID, researcherAuth, getUserSurveyById);



export default router;
