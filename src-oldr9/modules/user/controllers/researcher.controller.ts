import { ResearcherModel } from '../models/researcher.model';
import { AuthService } from '../services/auth.service';
import { makeAuthController } from './auth.controller';
import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { apiSuccessResponse } from '../../../utils/apiResponse';
import AppError from '../../../error-helpers/appError';

export const researcherAuth = new AuthService(ResearcherModel, 'researcher');
export const researcherController = makeAuthController(researcherAuth);

export const completeResearcherProfile = asyncHandler(async (req: Request, res: Response) => {
  const b = req.body;
  const user = await ResearcherModel.findById(req.user!.id);
  if (!user) throw new AppError('Account not found.', 404);
  user.set({
    firstName: b.firstName,
    lastName: b.lastName,
    organizationName: b.organization,
    country: user.country || b.country,
    purposeHere: b.purposeHere,
    researchType: b.researchType,
    researchInterest: b.researchInterest,
    address: { street: b.street, address2: b.address2, city: b.city, country: b.country },
    isCompleteProfile: true,
  });
  await user.save();
  apiSuccessResponse(res, 'Profile saved.', user.toJSON());
});
