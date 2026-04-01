import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { apiFailureResponse, apiSuccessResponse } from '../../utils/apiResponse';
import { SurveyService } from './project.service';

const surveyService = new SurveyService();

export const createSurvey = asyncHandler(
  async (req: Request, res: Response) => {
    const response = await surveyService.createSurvey(req.body);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    return apiSuccessResponse(res, response.message, response.data, 201);
  }
);

