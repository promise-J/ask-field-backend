"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResearcherModel = void 0;
const mongoose_1 = require("mongoose");
const researcherSchema = new mongoose_1.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
}, { timestamps: true });
exports.ResearcherModel = (0, mongoose_1.model)('Researcher', researcherSchema);
