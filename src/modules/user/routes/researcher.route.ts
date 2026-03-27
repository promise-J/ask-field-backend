import { Router } from "express";

import { validate } from "../../../middlewares/validate";
import {
  createParticipantSchema,
  createResearcherSchema,
  loginParticipantSchema,
  loginResearcherSchema,
} from "../user.validation";
import { authMiddleware } from "../../../middlewares/auth.middleware";
import {
  ROUTE_AUTH_LOGIN,
  ROUTE_AUTH_REGISTER,
  ROUTE_AUTH_VERIFY_EMAIL,
} from "../../../utils/page-routes";
import { createUser, loginUser, verifyEmail } from "../controllers/researcher.controller";

const router = Router();

router.post(ROUTE_AUTH_REGISTER, validate(createResearcherSchema), createUser);
router.post(ROUTE_AUTH_LOGIN, validate(loginResearcherSchema), loginUser);
router.get(ROUTE_AUTH_VERIFY_EMAIL, verifyEmail);

export default router;
