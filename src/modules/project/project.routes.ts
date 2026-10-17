import { Router } from 'express';
import { authMiddleware, requireRole } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate';
import { createProjectSchema, renameProjectSchema } from './project.validation';
import { createProject, deleteProject, getProject, listProjects, pinProject, renameProject } from './project.controller';

const router = Router();
router.use(authMiddleware, requireRole('researcher'));

router.get('/list-user-projects', listProjects);
router.post('/create-project', validate(createProjectSchema), createProject);
router.get('/get-project/:id', getProject);
router.put('/rename-project/:id', validate(renameProjectSchema), renameProject);
router.put('/pin-project/:id', pinProject);
router.delete('/delete-project/:id', deleteProject);

export default router;
