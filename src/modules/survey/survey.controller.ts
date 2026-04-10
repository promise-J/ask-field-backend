import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { apiFailureResponse, apiSuccessResponse } from '../../utils/apiResponse';
import { SurveyService } from './survey.service';

const surveyService = new SurveyService();

export const createDraftSurvey = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id || "";
    const response = await surveyService.createDraftSurvey(userId, req.body);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    return apiSuccessResponse(res, response.message, response.data, 201);
  }
);
export const updateDraftSurvey = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id || "";
    const surveyId = req.params.id;
    const response = await surveyService.updateDraftSurvey(surveyId, userId, req.body);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    return apiSuccessResponse(res, response.message, response.data, 201);
  }
);

export const publishSurvey = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id || "";
    const surveyId = req.params.id;
    const response = await surveyService.publishSurvey(surveyId, userId);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    return apiSuccessResponse(res, response.message, response.data, 201);
  }
);

export const createSurvey = asyncHandler(
  async (req: Request, res: Response) => {
    const response = await surveyService.createSurvey(req.body);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    return apiSuccessResponse(res, response.message, response.data, 201);
  }
);

export const getSurveysByProjectId = asyncHandler(
  async (req: Request, res: Response) => {
    const id = req.params.id;
    const userId = req.user?.id || "";
    const status = req.query.status as string | undefined;
    const response = await surveyService.getSurveysByProjectId(userId, id, status);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    return apiSuccessResponse(res, response.message, response.data, 201);
  }
);

export const getUserSurveyById = asyncHandler(
  async (req: Request, res: Response) => {
    const id = req.params.id;
    const userId = req.user?.id || "";
    const response = await surveyService.getUserSurveyById(userId, id);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    return apiSuccessResponse(res, response.message, response.data, 201);
  }
);

