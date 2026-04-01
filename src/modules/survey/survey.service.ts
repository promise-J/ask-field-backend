import { Request } from "express";
import { serviceResponse } from "../../utils/apiResponse";
import { SurveyRepository } from "./survey.repository";

type CreateSurveyReq = { email: string; password: string };

const surveyRepo = new SurveyRepository();

export class SurveyService {
  async createSurvey(data: CreateSurveyReq) {
    try {
      let user = await surveyRepo.findOne(data.email);
      

      return serviceResponse(
        true,
        "User created. Verification email sent.",
        user
      );
    } catch (error) {
      console.log(error, "the create survey");
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      );
    }
  }
}
