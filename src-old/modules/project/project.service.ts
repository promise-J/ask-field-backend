import { Request } from "express";
import { serviceResponse } from "../../utils/apiResponse";
import { ProjectRepository } from "./project.repository";
import { title } from "process";
import paginate from "../../utils/paginate";
import { ProjectModel } from "./project.model";

type CreateProjectReq = { participantView: string; title: string };

const projectRepo = new ProjectRepository();

export class ProjectService {
  async createProject(userId: string, data: CreateProjectReq) {
    try {
      let projectExists = await projectRepo.findOne({
        userId,
        title: data.title,
      });

      if (projectExists) {
        return serviceResponse(
          false,
          "Project with the same title already exists. Please choose a different title."
        );
      }

      const project = await projectRepo.create({
        userId,
        title: data.title,
        participantView: data.participantView,
      });

      return serviceResponse(true, "Project created successfully.", project);
    } catch (error) {
      console.log(error);
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      );
    }
  }
  async listUserProjects(
    userId: string,
    options: { page?: number; limit?: number } = {}
  ) {
    try {
      const result = await paginate(ProjectModel, { userId }, options);

      return serviceResponse(true, "Projects fetched successfully.", result);
    } catch (error) {
      console.log(error);
      return serviceResponse(
        false,
        "Something went wrong. Please try again later"
      );
    }
  }
  async getProjectById(projectId: string) {
    try {
      const project = await projectRepo.findById(projectId);

      if (!project) {
        return serviceResponse(false, "Project not found.");
      }

      return serviceResponse(true, "Project fetched successfully.", project);
    } catch (error) {
      console.log(error);
      return serviceResponse(
        false,
        "Something went wrong. Please try again later."
      );
    }
  }
  async deleteProject(projectId: string) {
    try {
      const project = await projectRepo.findById(projectId);

      if (!project) {
        return serviceResponse(false, "Project not found.");
      }

      await projectRepo.deleteById(projectId);

      return serviceResponse(true, "Project deleted successfully.");
    } catch (error) {
      console.log(error);
      return serviceResponse(
        false,
        "Something went wrong. Please try again later."
      );
    }
  }
  async renameProject(projectId: string, newTitle: string) {
    try {
      const project = await projectRepo.findById(projectId);

      if (!project) {
        return serviceResponse(false, "Project not found.");
      }

      // Check if another project with the new title already exists for the same user
      const existingProject = await projectRepo.findOne({
        userId: project.userId,
        title: newTitle,
      });

      if (existingProject) {
        return serviceResponse(
          false,
          "Another project with the same title already exists. Please choose a different title."
        );
      }

      project.title = newTitle;
      await project.save();

      return serviceResponse(true, "Project renamed successfully.", project);
    } catch (error) {
      console.log(error);
      return serviceResponse(
        false,
        "Something went wrong. Please try again later."
      );
    }
  }
  async pinProject(projectId: string) {
    try {
      const project = await projectRepo.findById(projectId);

      if (!project) {
        return serviceResponse(false, "Project not found.");
      }

      project.pinned = true;
      await project.save();

      return serviceResponse(true, "Project pinned successfully.", project);
    } catch (error) {
      console.log(error);
      return serviceResponse(
        false,
        "Something went wrong. Please try again later."
      );
    }
  }
}
