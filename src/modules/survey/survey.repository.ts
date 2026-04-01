import { SurveyModel } from "./survey.model";


export class SurveyRepository {
  async create(data: any) {
    return await SurveyModel.create(data);
  }

  async findById(id: string) {
    return await SurveyModel.findById(id);
  }

  async findOne(query: any) {
    return await SurveyModel.findOne(query);
  }
}
