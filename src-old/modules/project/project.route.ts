import { Router } from "express";

import { validate } from "../../middlewares/validate";
import {
  ROUTE_CREATE_PROJECT,
  ROUTE_DELETE_PROJECT_ID,
  ROUTE_GET_PROJECT_ID,
  ROUTE_LIST_USER_PROJECTS,
  ROUTE_PIN_PROJECT_ID,
  ROUTE_RENAME_PROJECT_ID,
} from "../../utils/page-routes";

import { createProjectSchema, renameProjectSchema } from "./project.validation";
import { createProject, deleteProject, getProjectById, listUserProjects, pinProject, renameProject } from "./project.controller";
import researcherAuth from "../../middlewares/auth/auth.researcher.middleware";

const router = Router();

router.post(ROUTE_CREATE_PROJECT, validate(createProjectSchema), researcherAuth, createProject);
router.get(ROUTE_LIST_USER_PROJECTS, researcherAuth, listUserProjects);
router.get(ROUTE_GET_PROJECT_ID, researcherAuth, getProjectById);
router.put(ROUTE_RENAME_PROJECT_ID, validate(renameProjectSchema), researcherAuth, renameProject);
router.put(ROUTE_PIN_PROJECT_ID, researcherAuth, pinProject);
router.delete(ROUTE_DELETE_PROJECT_ID, researcherAuth, deleteProject);



export default router;
