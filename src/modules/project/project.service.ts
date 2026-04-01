import { Request } from "express";
import { serviceResponse } from "../../utils/apiResponse";
import { ProjectRepository } from "./project.repository";

type CreateSurveyReq = { email: string; password: string };

const surveyRepo = new ProjectRepository();

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
