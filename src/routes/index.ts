import { Router } from 'express';
import participantRoutes from '../modules/user/routes/participant.routes';
import researcherRoutes from '../modules/user/routes/researcher.route';
import projectRoutes from '../modules/project/project.route';
import surveyRoutes from '../modules/survey/survey.route';
import seedRoutes from './seed.route';

const router = Router();

router.use('/participants', participantRoutes);
router.use('/researchers', researcherRoutes);
router.use('/projects', projectRoutes);
router.use('/surveys', surveyRoutes);
router.use('/seeds', seedRoutes);

export default router;
