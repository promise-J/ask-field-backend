import { SurveyModel } from "./survey.model";


export class SurveyRepository {
  async create(data: any) {
    return await SurveyModel.create(data);
  }

  async findById(id: string) {
    return await SurveyModel.findById(id);
  }

  async updateOne(query: any, data: any, options: any) {
    return await SurveyModel.findById(query, data, options);
  }

  async find(query: any) {
    return await SurveyModel.find(query);
  }
  async findOne(query: any) {
    return await SurveyModel.findOne(query);
  }
  async deleteOne(query: any) {
    return await SurveyModel.findOneAndDelete(query);
  }
}
