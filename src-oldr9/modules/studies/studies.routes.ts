import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { apiSuccessResponse } from '../../utils/apiResponse';
import { validate } from '../../middlewares/validate';
import { HIDE_REASONS } from './studyHide.model';
import * as studies from './studies.service';
import { SurveyService } from '../survey/survey.service';
import * as after from '../after/after.service';

const surveys = new SurveyService();

/** Participant Stage 3, mounted under /api/participants/me (participant token required). */
const router = Router();

router.get('/home', asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'ok', await studies.home(req.user!.id));
}));
router.get('/studies', asyncHandler(async (req: Request, res: Response) => {
  const home = await studies.home(req.user!.id);
  apiSuccessResponse(res, 'ok', { studies: home.studies, hiddenCount: home.hiddenCount, situation: home.situation });
}));
router.get('/studies/hidden', asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'ok', await studies.hiddenList(req.user!.id));
}));
router.get('/studies/:id', asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'ok', await studies.studyPage(req.user!.id, req.params.id));
}));
router.post(
  '/studies/:id/hide',
  validate(z.object({ reason: z.enum(HIDE_REASONS).optional().nullable() })),
  asyncHandler(async (req: Request, res: Response) => {
    apiSuccessResponse(res, 'Hidden. Thanks for telling us.', await studies.hide(req.user!.id, req.params.id, req.body.reason || undefined));
  })
);
router.delete('/studies/:id/hide', asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'It’s back on your list.', await studies.unhide(req.user!.id, req.params.id));
}));
// Participant Stage 4: type the finish code (canvas 4.2), or leave a study (canvas 4.4).
router.post('/studies/:id/finish', validate(z.object({ code: z.string().trim().min(1, 'Type the finish code.').max(40) })), asyncHandler(async (req: Request, res: Response) => {
  const r = await surveys.finishWithCode(req.user!.id, req.params.id, req.body.code);
  apiSuccessResponse(res, r.message, { outcome: r.outcome, amount: r.action?.amount ?? 0, currency: r.action?.currency || null, surveyId: req.params.id });
}));
router.post('/studies/:id/leave', validate(z.object({ reason: z.enum(studies.LEAVE_REASONS).optional().nullable() })), asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'You’ve left the study. Your place has gone to someone else.', await studies.leaveStudy(req.user!.id, req.params.id, req.body.reason || undefined));
}));
// Participant Stage 5: my studies, a decision and its reason, a question about it, and asking joinStudy to look.
router.get('/my-studies', asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'ok', await after.myStudies(req.user!.id));
}));
router.get('/my-studies/:id', asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'ok', await after.decision(req.user!.id, req.params.id));
}));
router.post(
  '/my-studies/:id/ask',
  validate(z.object({ why: z.enum(after.APPEAL_WHYS), message: z.string().trim().min(20, 'Say a little more (at least 20 characters), so the researcher can check.').max(2000, 'Keep it under 2,000 characters.') })),
  asyncHandler(async (req: Request, res: Response) => {
    apiSuccessResponse(res, 'Sent to the researcher.', await after.ask(req.user!.id, req.params.id, req.body));
  })
);
router.post('/my-studies/:id/escalate', asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Sent to joinStudy. We’ll decide within 5 working days.', await after.escalate(req.user!.id, req.params.id));
}));
router.put('/alerts', validate(z.object({ email: z.boolean() })), asyncHandler(async (req: Request, res: Response) => {
  const out = await studies.setAlerts(req.user!.id, req.body.email);
  apiSuccessResponse(res, out.email ? 'We’ll email you when a study fits.' : 'Study emails are off.', out);
}));

export default router;
