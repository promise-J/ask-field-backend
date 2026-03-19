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
    return apiSuccessResponse(res, response.message, response.data, 201);
  }
);

export const loginUser = asyncHandler(
  async (req: Request, res: Response) => {
    const response = await participantService.loginUser(req.body);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    return apiSuccessResponse(res, response.message, response.data, 201);
  }
);

export const verifyEmail = asyncHandler(
  async (req: Request, res: Response) => {
    const response = await participantService.verifyEmail(req);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    return apiSuccessResponse(res, response.message, response.data, 201);
  }
);

export const googleAuth = asyncHandler(
  async (req: Request, res: Response) => {
    const response = await participantService.googleAuth(req.body);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    return apiSuccessResponse(res, response.message, response.data, 201);
  }
);

export const getUser = asyncHandler(
  async (req: Request, res: Response) => {
    const response = await participantService.getUser(req);
    if(!response.success){
      return apiFailureResponse(res, response.message)
    }
    return apiSuccessResponse(res, response.message, response.data);
  }
);

export const completeProfile = asyncHandler(
  async (req: Request, res: Response)=>{
    const response = await participantService.completeProfile(req, req.body)
    if(!response.success){
      return apiFailureResponse(res, response.message)
    }
    return apiSuccessResponse(res, response.message, response.data)
  }
)

export const getRefreshToken = asyncHandler(
  async (req: Request, res: Response)=>{
    const response = await participantService.getRefreshToken(req)
    if(!response.success){
      return apiFailureResponse(res, response.message)
    }
    return apiSuccessResponse(res, response.message, response.data)
  }
)
