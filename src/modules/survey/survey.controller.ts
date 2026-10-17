import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { apiSuccessResponse } from '../../utils/apiResponse';
import { SurveyService } from './survey.service';
import * as plan from './plan.service';
import * as launch from '../billing/launch.service';

const service = new SurveyService();
const status = (req: Request) => (typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined);

export const createDraftSurvey = asyncHandler(async (req: Request, res: Response) => {
  const survey = await service.createDraft(req.user!.id, req.body.projectId, req.body.surveyName);
  apiSuccessResponse(res, 'Draft saved.', survey, 201);
});

export const startStudy = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Draft started.', await service.start(req.user!.id, req.body), 201);
});

export const updateDraftSurvey = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Draft saved.', await service.updateDraft(req.user!.id, req.params.id, req.body));
});

export const publishDraftSurvey = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Your study is live.', await service.publish(req.user!.id, req.params.id));
});

export const closeSurvey = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Study closed.', await service.close(req.user!.id, req.params.id));
});

export const getSurveysByProject = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Studies fetched.', await service.listByProject(req.user!.id, req.params.projectId, status(req)));
});

export const getAllSurveys = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Studies fetched.', await service.listAll(req.user!, status(req)));
});

export const getUserSurvey = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Study fetched.', await service.getForUser(req.user!, req.params.id));
});

export const checkEligibility = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'You qualify for this study.', await service.checkEligibility(req.user!.id, req.params.surveyId));
});

export const createSurveyAction = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Study started.', await service.createAction(req.user!.id, req.body.surveyId), 201);
});

export const verifySurveyAction = asyncHandler(async (req: Request, res: Response) => {
  const { action, message } = await service.submit(req.user!.id, req.params.id);
  apiSuccessResponse(res, message, action);
});

export const listSurveyActions = asyncHandler(async (req: Request, res: Response) => {
  const surveyId = typeof req.query.surveyId === 'string' ? req.query.surveyId : undefined;
  apiSuccessResponse(res, 'Submissions fetched.', await service.listActionsForResearcher(req.user!.id, surveyId));
});

export const getSurveyAction = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Submission fetched.', await service.getAction(req.user!, req.params.id));
});

export const approveSurveyAction = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Submission approved. The participant has been paid.', await service.review(req.user!.id, req.params.id, 'approved'));
});

export const rejectSurveyAction = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Submission rejected.', await service.review(req.user!.id, req.params.id, 'rejected'));
});

export const dashboardStats = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Dashboard stats fetched.', await service.dashboardStats(req.user!.id));
});

// ---------- Stage 4: the planner ----------

export const getPlan = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'ok', await plan.planView(req.user!.id, req.params.id));
});

export const savePlanStep = asyncHandler(async (req: Request, res: Response) => {
  const { view, fields } = await plan.saveStep(req.user!.id, req.params.id, req.params.step as any, req.body.data || {}, !!req.body.final);
  apiSuccessResponse(res, 'Saved.', { ...view, fields });
});

export const planMatchCount = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'ok', await plan.matchCount(req.user!.id, req.params.id));
});

export const screen = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'You qualify for this study.', await service.checkEligibility(req.user!.id, req.params.id, { answers: req.body.answers }));
});

export const startLink = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'ok', await plan.recordConsentAndStartLink(req.user!.id, req.params.id, !!req.body.consent));
});

export const finishByCode = asyncHandler(async (req: Request, res: Response) => {
  const { action, message } = await service.submitByCode(req.user!.id, req.params.code);
  apiSuccessResponse(res, message, action);
});

// ---------- Stage 5: fund and launch ----------
export const getLaunch = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'ok', await launch.launchView(req.user!.id, req.params.id));
});
export const launchPay = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'ok', await launch.pay(req.user!.id, req.params.id, req.body), 201);
});
export const launchResubmit = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Sent back to us.', await launch.resubmit(req.user!.id, req.params.id));
});
export const launchCancelInvoice = asyncHandler(async (req: Request, res: Response) => {
  apiSuccessResponse(res, 'Invoice cancelled.', await launch.cancelInvoice(req.user!.id, req.params.id));
});
