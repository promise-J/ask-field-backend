import { Request, Response } from 'express';
import { ParticipantService } from '../services/participant.service';
import { asyncHandler } from '../../../utils/asyncHandler';
import { apiFailureResponse, apiSuccessResponse } from '../../../utils/apiResponse';

const participantService = new ParticipantService();

export const createUser = asyncHandler(
  async (req: Request, res: Response) => {
    const response = await participantService.createUser(req.body);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    apiSuccessResponse(res, response.message, response, 201);
  }
);

export const verifyEmail = asyncHandler(
  async (req: Request, res: Response) => {
    const response = await participantService.verifyEmail(req.body, req);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    apiSuccessResponse(res, response.message, response, 201);
  }
);

export const googleAuth = asyncHandler(
  async (req: Request, res: Response) => {
    const response = await participantService.googleAuth(req.body);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    apiSuccessResponse(res, response.message, response, 201);
  }
);

export const getUser = asyncHandler(
  async (req: Request, res: Response) => {
    const user = await participantService.getUser(req.params.id);
    apiSuccessResponse(res, 'User Fetched',user);
  }
);
