"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResearcherRepository = void 0;
const researcher_model_1 = require("../models/researcher.model");
class ResearcherRepository {
    create(data) {
        return researcher_model_1.ResearcherModel.create(data);
    }
    findByEmail(email) {
        return researcher_model_1.ResearcherModel.findOne({ email });
    }
    findById(id) {
        return researcher_model_1.ResearcherModel.findById(id);
    }
}
exports.ResearcherRepository = ResearcherRepository;
