import { Router } from 'express';
import { authMiddleware, requireRole } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate';
import { launchPaySchema, createDraftSurveySchema, createSurveyActionSchema, planStepSchema, screenSchema, startLinkSchema, startStudySchema, updateDraftSurveySchema } from './survey.validation';
import * as c from './survey.controller';

const router = Router();
const researcher = requireRole('researcher');
const participant = requireRole('participant');

router.use(authMiddleware);

// Researchers build and review studies
router.post('/start', researcher, validate(startStudySchema), c.startStudy);
// Stage 4 planner
router.get('/:id/plan', researcher, c.getPlan);
router.get('/:id/plan/match', researcher, c.planMatchCount);
router.put('/:id/plan/:step', researcher, validate(planStepSchema), c.savePlanStep);
// Stage 5 launch
router.get('/:id/launch', researcher, c.getLaunch);
router.post('/:id/launch/pay', researcher, validate(launchPaySchema), c.launchPay);
router.post('/:id/launch/resubmit', researcher, c.launchResubmit);
router.post('/:id/launch/cancel-invoice', researcher, c.launchCancelInvoice);
router.post('/create-draft-survey', researcher, validate(createDraftSurveySchema), c.createDraftSurvey);
router.put('/update-draft-survey/:id', researcher, validate(updateDraftSurveySchema), c.updateDraftSurvey);
router.post('/publish-draft-survey/:id', researcher, c.publishDraftSurvey);
router.put('/close-survey/:id', researcher, c.closeSurvey);
router.get('/get-surveys-by-project/:projectId', researcher, c.getSurveysByProject);
router.get('/list-survey-actions', researcher, c.listSurveyActions);
router.put('/approve-survey-action/:id', researcher, c.approveSurveyAction);
router.put('/reject-survey-action/:id', researcher, c.rejectSurveyAction);

// Both account types (results are scoped to the caller)
router.get('/get-all-surveys', c.getAllSurveys);
router.get('/get-user-survey/:id', c.getUserSurvey);
router.get('/get-survey-actions/:id', c.getSurveyAction);

// Participants take studies
router.get('/check-eligibility/:surveyId', participant, c.checkEligibility);
router.post('/create-survey-action', participant, validate(createSurveyActionSchema), c.createSurveyAction);
router.get('/verify-survey-action/:id', participant, c.verifySurveyAction);
router.post('/:id/screen', participant, validate(screenSchema), c.screen);
router.post('/:id/start-link', participant, validate(startLinkSchema), c.startLink);
router.post('/done/:code', participant, c.finishByCode);

export default router;
