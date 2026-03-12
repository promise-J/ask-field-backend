"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUser = exports.createUser = void 0;
const researcher_service_1 = require("../services/researcher.service");
const asyncHandler_1 = require("../../../utils/asyncHandler");
const apiResponse_1 = require("../../../utils/apiResponse");
const researcherService = new researcher_service_1.ResearcherService();
exports.createUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const user = await researcherService.createUser(req.body);
    (0, apiResponse_1.apiSuccessResponse)(res, 'User created', user, 201);
});
exports.getUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const user = await researcherService.getUser(req.params.id);
    (0, apiResponse_1.apiSuccessResponse)(res, 'User Fetched', user);
});
