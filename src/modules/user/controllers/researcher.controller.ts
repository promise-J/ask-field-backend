import { Request, Response } from "express";
import { ResearcherService } from "../services/researcher.service";
import { asyncHandler } from "../../../utils/asyncHandler";
import {
  apiFailureResponse,
  apiSuccessResponse,
} from "../../../utils/apiResponse";

const researcherService = new ResearcherService();

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const response = await researcherService.createUser(req.body);
  if (!response.success) {
    return apiFailureResponse(res, response.message);
  }
  return apiSuccessResponse(res, response.message, response.data, 201);
});

export const loginUser = asyncHandler(async (req: Request, res: Response) => {
  const response = await researcherService.loginUser(req.body);
  if (!response.success) {
    return apiFailureResponse(res, response.message);
  }
  return apiSuccessResponse(res, response.message, response.data, 201);
});
export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const response = await researcherService.verifyEmail(req);
  if (!response.success) {
    return apiFailureResponse(res, response.message);
  }
  return apiSuccessResponse(res, response.message, response.data, 201);
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const response = await researcherService.getUser(req);
  if (!response.success) {
    return apiFailureResponse(res, response.message);
  }
  return apiSuccessResponse(res, response.message, response.data, 201);
});
