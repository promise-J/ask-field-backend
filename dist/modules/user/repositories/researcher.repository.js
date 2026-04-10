"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResearcherRepository = void 0;
const researcher_model_1 = require("../models/researcher.model");
class ResearcherRepository {
    async create(data) {
        return await researcher_model_1.ResearcherModel.create(data);
    }
    async findByEmail(email) {
        return await researcher_model_1.ResearcherModel.findOne({ email });
    }
    async findById(id) {
        return await researcher_model_1.ResearcherModel.findById(id);
    }
}
exports.ResearcherRepository = ResearcherRepository;
