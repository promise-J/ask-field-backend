import { SurveyActionModel } from "../models/survey.action.model";



export class SurveyActionRepository {
  async create(data: any) {
    return await SurveyActionModel.create(data);
  }

  async findById(id: string) {
    return await SurveyActionModel.findById(id);
  }

  async updateOne(query: any, data: any, options?: any) {
    return await SurveyActionModel.findOneAndUpdate(
      query,
      { $set: data },
      { new: true, ...options }
    );
  }

  async find(query: any) {
    return await SurveyActionModel.find(query);
  }
  async findOne(query: any) {
    return await SurveyActionModel.findOne(query);
  }
  async deleteOne(query: any) {
    return await SurveyActionModel.findOneAndDelete(query);
  }
}
