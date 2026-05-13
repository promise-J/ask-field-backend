import { Request } from "express";
import { UAParser } from 'ua-parser-js';

import { serviceResponse } from "../../utils/apiResponse";
import { SurveyRepository } from "./repositories/survey.repository";
import z from "zod";
import { ParticipantRepository } from "../user/repositories/participant.repository";
import { ParticipantProfileRepository } from "../user/repositories/participant.profile.repository";
import { getUserAge } from "../../utils/helper";
import { SurveyActionRepository } from "./repositories/survey.action.repository";
import { SurveyModel } from "./models/survey.model";
import { Types } from "mongoose";

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
const surveyActionRepo = new SurveyActionRepository();
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
  async getAllSurveys( status: string = "published") {
    try {
      const filter = {status, surveyLabel: "survey"}
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

     

      const parser = new UAParser(req.headers['user-agent']);
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

      const surveyActionExists = await surveyActionRepo.findOne({participantId: userId || "", surveyId});

      if(surveyActionExists && surveyActionExists.status === "approved"){
        return serviceResponse(
          true,
          "You have already completed this survey.",
          surveyActionExists
        );
      }

      if(surveyActionExists && surveyActionExists.status === "rejected"){
        return serviceResponse(
          true,
          "You have already completed this survey.",
          surveyActionExists
        );

      }

      if(surveyActionExists && surveyActionExists.status === "awaiting"){
        return serviceResponse(
          true,
          "You have already submitted this survey.",
          surveyActionExists
        );
      }

      let surveyAction = null;
      if(!surveyActionExists){
        surveyAction = await surveyActionRepo.create({
          participantId: userId || "",
          surveyId,
          status: "in-progress"
        });
      }

      const surveyActionResult = surveyActionExists ? surveyActionExists : surveyAction;

      return serviceResponse(
        true,
        "User is eligible to take the survey.",
        surveyActionResult
      );
    } catch (error) {
      console.log(error);
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      );
    }
  }

  async createSurveyAction(req: Request){
    try {
      const userId = req.user?.id;
      const surveyId = req.body.surveyId;

      const surveyActionExists = await surveyActionRepo.findOne({participantId: userId || "", surveyId});

      if(surveyActionExists?.status || surveyActionExists?.status === "approved"){
        return serviceResponse(
          true,
          "You have already completed this survey.",
          surveyActionExists
        );
      }

      if(surveyActionExists?.status || surveyActionExists?.status === "rejected"){
        return serviceResponse(
          true,
          "You have already completed this survey.",
          surveyActionExists
        );

      }
      if(surveyActionExists?.status || surveyActionExists?.status === "awaiting"){
        return serviceResponse(
          true,
          "You have already submitted this survey.",
          surveyActionExists
        );
      }

      if(surveyActionExists?.status || surveyActionExists?.status === "in-progress"){
        return serviceResponse(
          true,
          "Survey action already exists.",
          surveyActionExists
        );
      }

        const surveyAction = await surveyActionRepo.create({
          participantId: userId || "",
          surveyId,
          status: "in-progress"
        });

        return serviceResponse(
          true,
          "Survey action created successfully.",
          surveyAction
        );

    } catch (error) {
      console.log(error)
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      )
    }
  }
  async verifySurveyAction(req: Request){
    try {
      const userId = req.user?.id;
      const surveyId = req.params.surveyActionId;

      const surveyActionExists = await surveyActionRepo.findOne({participantId: userId || "", surveyId});

      if(!surveyActionExists){
        return serviceResponse(
          false,
          "Survey not found."
        );
      }

      const now = new Date();
      const seconds = Math.floor((now.getTime() - surveyActionExists.startedAt.getTime()) / 1000);

      surveyActionExists.status = "awaiting";
      surveyActionExists.submittedAt = new Date();
      surveyActionExists.timeSpent = seconds;
      await surveyActionExists.save();

      // send email: Awaiting response approval: Your response to customer is under approval

      return serviceResponse(
        true,
        "Survey submitted successfully and is awaiting review.",
        surveyActionExists
      );
      
    } catch (error) {
      console.log(error)
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      )
    }
  }
  async approveSurveyAction(req: Request){
    try {
      // const userId = req.user?.id;
      const surveyActionId = req.params.surveyActionId;

      const surveyActionExists = await surveyActionRepo.findOne({_id: surveyActionId});

      if(!surveyActionExists){
        return serviceResponse(
          false,
          "Survey not found."
        );
      }

      surveyActionExists.status = "approved";
      await surveyActionExists.save();

      // send email: Response approval: Your response to customer has been approved

      return serviceResponse(
        true,
        "Survey has been approved successfully",
        surveyActionExists
      );
      
    } catch (error) {
      console.log(error)
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      )
    }
  }
  async rejectSurveyAction(req: Request){
    try {
      // const userId = req.user?.id;
      const surveyActionId = req.params.surveyActionId;

      const surveyActionExists = await surveyActionRepo.findOne({_id: surveyActionId});

      if(!surveyActionExists){
        return serviceResponse(
          false,
          "Survey not found."
        );
      }

      surveyActionExists.status = "rejected";
      await surveyActionExists.save();

      // send email: Response rejection: Your response to customer has been rejected

      return serviceResponse(
        true,
        "Survey has been rejected successfully",
        surveyActionExists
      );
      
    } catch (error) {
      console.log(error)
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      )
    }
  }
  async listSurveyActions(req: Request){
    try {
      const userId = req.user?.id;

      const surveys = await SurveyModel.find({
        userId: new Types.ObjectId(userId)
      }).select("_id");

      const surveyIds = surveys.map(
        (survey: any) => survey._id
      );

      const surveyActions =
      await surveyActionRepo.find({
        surveyId: { $in: surveyIds }
      });

      return serviceResponse(
        true,
        "Survey actions fetched successfully.",
        surveyActions || []
      );
    } catch (error) {
      console.log(error)
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      )
    }
  }
  async getSurveyActionById(req: Request){
    try {
      const surveyActionId = req.params.surveyActionId;
      const surveyAction = await surveyActionRepo.findOne({_id: surveyActionId});

      if(!surveyAction){
        return serviceResponse(
          false,
          "Survey action not found."
        );
      }

      return serviceResponse(
        true,
        "Survey action fetched successfully.",
        surveyAction
      );
    } catch (error) {
      console.log(error)
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      )
    }
  }
  async getSurveyActionBySurveyId(req: Request){
    try {
      const surveyId = req.params.surveyId;
      const surveyAction = await surveyActionRepo.findOne({surveyId});

      if(!surveyAction){
        return serviceResponse(
          false,
          "Survey action not found."
        );
      }

      return serviceResponse(
        true,
        "Survey action fetched successfully.",
        surveyAction
      );
    } catch (error) {
      console.log(error)
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      )
    }
  }
}
