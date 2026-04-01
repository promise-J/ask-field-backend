import { Request, Response, Router } from "express";
import { ROUTE_SEED_ALL } from "../utils/page-routes";
import { asyncHandler } from "../utils/asyncHandler";
import { apiFailureResponse, apiSuccessResponse } from "../utils/apiResponse";
import { ProjectModel } from "../modules/project/project.model";
import { SurveyModel } from "../modules/survey/survey.model";

const router = Router();

router.get(ROUTE_SEED_ALL, asyncHandler(async (req: Request, res: Response)=>{
    try {
        const userId = "69c69bafa3c187d5008258ed";

      // Check existing data
      const existingProjects = await ProjectModel.find({ userId });
      const existingSurveys = await SurveyModel.find({ userId });

      let createdProjects = existingProjects;
      let createdSurveys = existingSurveys;

      // Seed Projects if none exist
      if (existingProjects.length === 0) {
        const projects = [
          {
            userId,
            title: "Customer Feedback Project",
            participantView: "public",
          },
          {
            userId,
            title: "Product Testing Project",
            participantView: "private",
          },
        ];

        await ProjectModel.insertMany(projects);
      }

      // Seed Surveys if none exist
      if (existingSurveys.length === 0) {
        // Ensure we have projects to attach surveys to
        const projectsToUse =
          createdProjects.length > 0
            ? createdProjects
            : await ProjectModel.find({ userId });

        const surveys = [
          {
            userId,
            projectId: projectsToUse[0]._id,
            surveyType: "feedback",
            surveyName: "Customer Satisfaction Survey",
            internalSurveyName: "CSS-001",
            surveyDescription: "Survey to measure customer satisfaction",
            surveyLabel: "CSAT",
            usableDevices: ["mobile", "desktop"],
            numberOfParticipants: 100,
            surveyDuration: 10,
            surveyAmount: 5,
          },
          {
            userId,
            projectId: projectsToUse[0]._id,
            surveyType: "nps",
            surveyName: "Net Promoter Score Survey",
            internalSurveyName: "NPS-001",
            surveyDescription: "Measure likelihood of recommendation",
            surveyLabel: "NPS",
            usableDevices: ["mobile"],
            numberOfParticipants: 80,
            surveyDuration: 5,
            surveyAmount: 3,
          },
          {
            userId,
            projectId: projectsToUse[1]._id,
            surveyType: "usability",
            surveyName: "App Usability Survey",
            internalSurveyName: "USAB-001",
            surveyDescription: "Test usability of the mobile app",
            surveyLabel: "USABILITY",
            usableDevices: ["mobile"],
            numberOfParticipants: 50,
            surveyDuration: 15,
            surveyAmount: 10,
          },
          {
            userId,
            projectId: projectsToUse[1]._id,
            surveyType: "research",
            surveyName: "Market Research Survey",
            internalSurveyName: "MR-001",
            surveyDescription: "General market research survey",
            surveyLabel: "MARKET",
            usableDevices: ["desktop"],
            numberOfParticipants: 120,
            surveyDuration: 20,
            surveyAmount: 8,
          },
        ];

        await SurveyModel.insertMany(surveys);
      }

      return apiSuccessResponse(
        res,
        "Seed data checked/created successfully",
        {
          projects: createdProjects,
          surveys: createdSurveys,
        },
        201
      );
      } catch (error) {
        console.error(error);
        return apiFailureResponse(res, 'Something went wrong while seeding data. Please try again later.');
      }
}));



export default router;
