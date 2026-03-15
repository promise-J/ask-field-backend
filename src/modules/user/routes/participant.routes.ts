import { Router } from 'express';
import { createUser, getUser, googleAuth, loginUser, verifyEmail } from '../controllers/participant.controller';
import { validate } from '../../../middlewares/validate';
import { createParticipantSchema, loginParticipantSchema, verifyEmailQuerySchema } from '../user.validation';
import { validateQuery } from '../../../middlewares/validateQuery';

const router = Router();

router.post('/auth/register', validate(createParticipantSchema),createUser);
router.post('/auth/login', validate(loginParticipantSchema),loginUser);
router.get('/auth/verify-email', verifyEmail);
router.post('/auth/google-auth', googleAuth);
router.get('/:id', getUser);

export default router;
