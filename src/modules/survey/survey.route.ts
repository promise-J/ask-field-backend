import { Router } from "express";

import { validate } from "../../middlewares/validate";
import {
  ROUTE_CREATE_SURVEY,
} from "../../utils/page-routes";

import { createSurveySchema } from "./survey.validation";
import { createSurvey } from "./survey.controller";
import researcherAuth from "../../middlewares/auth/auth.researcher.middleware";

const router = Router();

router.post(ROUTE_CREATE_SURVEY, validate(createSurveySchema), researcherAuth, createSurvey);



export default router;
