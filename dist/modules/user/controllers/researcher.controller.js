"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.researcherDashboardStats = exports.getUser = exports.verifyEmail = exports.loginUser = exports.createUser = void 0;
const researcher_service_1 = require("../services/researcher.service");
const asyncHandler_1 = require("../../../utils/asyncHandler");
const apiResponse_1 = require("../../../utils/apiResponse");
const researcherService = new researcher_service_1.ResearcherService();
exports.createUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const response = await researcherService.createUser(req.body);
    if (!response.success) {
        return (0, apiResponse_1.apiFailureResponse)(res, response.message);
    }
    return (0, apiResponse_1.apiSuccessResponse)(res, response.message, response.data, 201);
});
exports.loginUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const response = await researcherService.loginUser(req.body);
    if (!response.success) {
        return (0, apiResponse_1.apiFailureResponse)(res, response.message);
    }
    return (0, apiResponse_1.apiSuccessResponse)(res, response.message, response.data, 201);
});
exports.verifyEmail = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const response = await researcherService.verifyEmail(req);
    if (!response.success) {
        return (0, apiResponse_1.apiFailureResponse)(res, response.message);
    }
    return (0, apiResponse_1.apiSuccessResponse)(res, response.message, response.data, 201);
});
exports.getUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const response = await researcherService.getUser(req);
    if (!response.success) {
        return (0, apiResponse_1.apiFailureResponse)(res, response.message);
    }
    return (0, apiResponse_1.apiSuccessResponse)(res, response.message, response.data, 201);
});
exports.researcherDashboardStats = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const response = await researcherService.researcherDashboardStats(req);
    if (!response.success) {
        return (0, apiResponse_1.apiFailureResponse)(res, response.message);
    }
    return (0, apiResponse_1.apiSuccessResponse)(res, response.message, response.data, 201);
});
