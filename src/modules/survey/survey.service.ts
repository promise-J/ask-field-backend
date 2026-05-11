import { Request } from "express";
import * as UAParser from 'ua-parser-js';

import { serviceResponse } from "../../utils/apiResponse";
import { SurveyRepository } from "./survey.repository";
import z from "zod";
import { ParticipantRepository } from "../user/repositories/participant.repository";
import { ParticipantProfileRepository } from "../user/repositories/participant.profile.repository";
import { getUserAge } from "../../utils/helper";

type CreateSurveyReq = {
  userId: string;
  projectId: string;

  surveyType: string;
  surveyName: string;
  internalSurveyName?: string;

  surveyDescription: string;
  surveyLabel: string;

  usableDevices?: string[];

  surveyEquipment?: string;
  contentWarning?: string;
  surveyURL?: string;
  status?: string;

  toRecordId?: string;
  handleSubmission?: string;
  addToParticipantGroup?: string;
  howToFindParticipant?: string;

  numberOfParticipants?: number;

  howToScreenParticipants?: string;
  surveyDistribution?: string;
  surveyCrendentials?: string;

  totalSubmission?: number;
  inputRejection?: number;
  surveyDuration?: number;
  surveyAmount?: number;
  mininumAge?: number;
  maximumAge?: number;
  gender?: string;
};


const surveyRepo = new SurveyRepository();
const participantRepo = new ParticipantRepository();
const participantProfileRepo = new ParticipantProfileRepository()

export class SurveyService {
  async createDraftSurvey(userId: string, data: Partial<CreateSurveyReq>) {
    try {
      const survey = await surveyRepo.create({
        userId,
        ...data,
        status: "draft",
      });
  
      return serviceResponse(
        true,
        "Draft survey created successfully.",
        survey
      );
    } catch (error) {
      console.log(error, "create draft survey error");
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      );
    }
  }
  async updateDraftSurvey(surveyId: string, userId: string, data: Partial<CreateSurveyReq>) {
    try {
      console.log(surveyId, data,'the survey')
      const survey = await surveyRepo.updateOne(
        {
          _id: surveyId,
          userId,
          status: "draft",
        },
        data
      );
  
      if (!survey) {
        return serviceResponse(false, "Draft survey not found.");
      }
  
      return serviceResponse(
        true,
        "Draft survey updated successfully.",
        survey
      );
    } catch (error) {
      console.log(error, "update draft survey error");
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      );
    }
  }
  async publishSurvey(surveyId: string, userId: string) {
    try {
      const survey = await surveyRepo.findOne({
        _id: surveyId,
        userId,
        status: "draft",
      });
  
      if (!survey) {
        return serviceResponse(false, "Draft survey not found.");
      }
  
      // 🔐 validation before publishing
      if (
        !survey.surveyName ||
        !survey.surveyDescription ||
        !survey.surveyType
      ) {
        return serviceResponse(
          false,
          "Please complete all required fields before publishing."
        );
      }
  
      survey.status = "published";
      await survey.save();
  
      return serviceResponse(
        true,
        "Survey published successfully.",
        survey
      );
    } catch (error) {
      console.log(error, "publish survey error");
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      );
    }
  }
  async createSurvey(data: CreateSurveyReq) {
    try {

      const survey = await surveyRepo.create(data);

      return serviceResponse(
        true,
        "Survey created successfully.",
        survey
      );
    } catch (error) {
      console.log(error, "the create survey");
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      );
    }
  }
  async getSurveysByProjectId(userId: string, projectId: string, status: string = "published") {
    try {
      const filter = {userId, projectId, status, surveyLabel: "survey"}
      const surveys = await surveyRepo.find(filter);

      return serviceResponse(
        true,
        "Surveys fetched successfully.",
        surveys
      );
    } catch (error) {
      console.log(error, "the get surveys by project id");
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      );
    }
  }
  async getUserSurveyById(userId: string, surveyId: string) {
    try {
      const survey = await surveyRepo.findOne({_id: surveyId, userId});

      if (!survey) {
        return serviceResponse(
          false,
          "Survey not found or you don't have access to it."
        );
      }

      return serviceResponse(
        true,
        "Survey fetched successfully.",
        survey
      );

    } catch (error) {
      console.log(error);
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      );
    }
  }
  async checkEligibility(req: Request){
    try {

      const surveyId = req.params.surveyId;
      const userId = req.user?.id;
      // const parser = new UAParser(req.headers['user-agent']);
      if(!surveyId){
        return serviceResponse(
          false,
          "Survey ID is required."
        );
      }

      const survey = await surveyRepo.findOne({_id: surveyId, status: "published"});
      const user = await participantRepo.findById(userId || "");

      const userProfile = await participantProfileRepo.findOne({userId: userId || ""});
      if(!userProfile || userProfile.status !== "completed"){
        return serviceResponse(
          false,
          "Please complete your profile before taking the survey."
        );
      }

      if(!user){
        return serviceResponse(
          false,
          "User not found."
        );
      }

      if(!survey){
        return serviceResponse(
          false,
          "Survey not found or not published yet."
        );
      }

      const parser = new (UAParser as any)(req.headers['user-agent']);
      const device = parser.getDevice();
      // console.log(device.type);

      if(survey.usableDevices && survey.usableDevices.length > 0 && device.type && !survey.usableDevices.includes(device.type)){
        return serviceResponse(
          false,
          `This survey is only available on ${survey.usableDevices.join(", ")} devices.`
        );
      }

      // if(userProfile.countryOfResidence !== survey.cou && survey.surveyDistribution === "international"){ add country later
      // if(){
      //   return serviceResponse(
      //     false,
      //     "This survey is only available for participants residing in specific countries."
      //   );
      // }

      const userAge = getUserAge(userProfile.dob_year)

      if((survey.minimumAge && userAge < survey.minimumAge) || (survey.maximumAge && userAge > survey.maximumAge)){
        return serviceResponse(
          false,
          `This survey is only available for participants between ${survey.minimumAge} and ${survey.maximumAge} years old.`
        );
      }

      return serviceResponse(
        true,
        "User is eligible to take the survey."
      );
    } catch (error) {
      console.log(error);
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      );
    }
  }
}
