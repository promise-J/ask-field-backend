"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParticipantRepository = void 0;
const participant_model_1 = require("../models/participant.model");
class ParticipantRepository {
    async create(data) {
        return await participant_model_1.ParticipantModel.create(data);
    }
    async findByEmail(email) {
        return await participant_model_1.ParticipantModel.findOne({ email });
    }
    async findById(id) {
        return await participant_model_1.ParticipantModel.findById(id);
    }
    async findOne(query) {
        return await participant_model_1.ParticipantModel.findOne(query);
    }
}
exports.ParticipantRepository = ParticipantRepository;
