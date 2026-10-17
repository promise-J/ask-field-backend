import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { apiFailureResponse, apiSuccessResponse } from '../../utils/apiResponse';
import { ProjectService } from './project.service';
import { id } from 'zod/v4/locales';

const projectService = new ProjectService();

export const createProject = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id || "";
    const response = await projectService.createProject(userId, req.body);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    return apiSuccessResponse(res, response.message, response.data, 201);
  }
);
export const listUserProjects = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id || "";
    const response = await projectService.listUserProjects(userId, req.query);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    return apiSuccessResponse(res, response.message, response.data, 201);
  }
);
export const getProjectById = asyncHandler(
  async (req: Request, res: Response) => {
    const {id} = req.params;
    const response = await projectService.getProjectById(id);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    return apiSuccessResponse(res, response.message, response.data, 201);
  }
);
export const renameProject = asyncHandler(
  async (req: Request, res: Response) => {
    const id = req.params.id
    const newTitle = req.body.title;
    const response = await projectService.renameProject(id, newTitle);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    return apiSuccessResponse(res, response.message, response.data, 201);
  }
);
export const pinProject = asyncHandler(
  async (req: Request, res: Response) => {
    const id = req.params.id
    const response = await projectService.pinProject(id);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    return apiSuccessResponse(res, response.message, response.data, 201);
  }
);
export const deleteProject = asyncHandler(
  async (req: Request, res: Response) => {
    const id = req.params.id
    const response = await projectService.deleteProject(id);
    if(!response.success){
      return apiFailureResponse(res, response.message);
    }
    return apiSuccessResponse(res, response.message, response.data, 201);
  }
);

