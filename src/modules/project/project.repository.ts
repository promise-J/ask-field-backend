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

  async find(query: any) {
    return await ProjectModel.find(query);
  }
  async deleteById(id: string) {
    return await ProjectModel.findByIdAndDelete(id);
  }
}
