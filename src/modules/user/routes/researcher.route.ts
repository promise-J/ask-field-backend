import { Router } from "express";

import { validate } from "../../../middlewares/validate";
import {
  createParticipantSchema,
  createResearcherSchema,
  loginParticipantSchema,
  loginResearcherSchema,
} from "../user.validation";
import { authMiddleware } from "../../../middlewares/auth/auth.middleware";
import {
  ROUTE_AUTH_LOGIN,
  ROUTE_AUTH_REGISTER,
  ROUTE_AUTH_VERIFY_EMAIL,
  ROUTE_DASHBOARD_STATS,
  ROUTE_ME,
} from "../../../utils/page-routes";
import { createUser, getUser, loginUser, researcherDashboardStats, verifyEmail } from "../controllers/researcher.controller";
import researcherAuth from "../../../middlewares/auth/auth.researcher.middleware";

const router = Router();

router.post(ROUTE_AUTH_REGISTER, validate(createResearcherSchema), createUser);
router.post(ROUTE_AUTH_LOGIN, validate(loginResearcherSchema), loginUser);
router.get(ROUTE_AUTH_VERIFY_EMAIL, verifyEmail);
router.get(ROUTE_ME, authMiddleware, getUser);
router.get(ROUTE_DASHBOARD_STATS, researcherAuth, researcherDashboardStats);


export default router;
