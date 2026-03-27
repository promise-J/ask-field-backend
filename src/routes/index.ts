import { Router } from 'express';
import participantRoutes from '../modules/user/routes/participant.routes';
import researcherRoutes from '../modules/user/routes/researcher.route';

const router = Router();

router.use('/participants', participantRoutes);
router.use('/researchers', researcherRoutes);

export default router;
