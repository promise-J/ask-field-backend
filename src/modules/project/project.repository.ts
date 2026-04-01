import { ProjectModel } from "./project.model";


export class ProjectRepository {
  async create(data: any) {
    return await ProjectModel.create(data);
  }

  async findById(id: string) {
    return await ProjectModel.findById(id);
  }

  async findOne(query: any) {
    return await ProjectModel.findOne(query);
  }
}
