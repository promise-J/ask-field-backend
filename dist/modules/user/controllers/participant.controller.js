"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPassword = exports.verifyOtp = exports.sendOtp = exports.getRefreshToken = exports.completeProfile = exports.getUser = exports.googleAuth = exports.verifyEmail = exports.loginUser = exports.createUser = void 0;
const participant_service_1 = require("../services/participant.service");
const asyncHandler_1 = require("../../../utils/asyncHandler");
const apiResponse_1 = require("../../../utils/apiResponse");
const participantService = new participant_service_1.ParticipantService();
exports.createUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const response = await participantService.createUser(req.body);
    if (!response.success) {
        return (0, apiResponse_1.apiFailureResponse)(res, response.message);
    }
    return (0, apiResponse_1.apiSuccessResponse)(res, response.message, response.data, 201);
});
exports.loginUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const response = await participantService.loginUser(req.body);
    if (!response.success) {
        return (0, apiResponse_1.apiFailureResponse)(res, response.message);
    }
    return (0, apiResponse_1.apiSuccessResponse)(res, response.message, response.data, 201);
});
exports.verifyEmail = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const response = await participantService.verifyEmail(req);
    if (!response.success) {
        return (0, apiResponse_1.apiFailureResponse)(res, response.message);
    }
    return (0, apiResponse_1.apiSuccessResponse)(res, response.message, response.data, 201);
});
exports.googleAuth = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const response = await participantService.googleAuth(req.body);
    if (!response.success) {
        return (0, apiResponse_1.apiFailureResponse)(res, response.message);
    }
    return (0, apiResponse_1.apiSuccessResponse)(res, response.message, response.data, 201);
});
exports.getUser = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const response = await participantService.getUser(req);
    if (!response.success) {
        return (0, apiResponse_1.apiFailureResponse)(res, response.message);
    }
    return (0, apiResponse_1.apiSuccessResponse)(res, response.message, response.data);
});
exports.completeProfile = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const response = await participantService.completeProfile(req, req.body);
    if (!response.success) {
        return (0, apiResponse_1.apiFailureResponse)(res, response.message);
    }
    return (0, apiResponse_1.apiSuccessResponse)(res, response.message, response.data);
});
exports.getRefreshToken = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const response = await participantService.getRefreshToken(req);
    if (!response.success) {
        return (0, apiResponse_1.apiFailureResponse)(res, response.message);
    }
    return (0, apiResponse_1.apiSuccessResponse)(res, response.message, response.data);
});
exports.sendOtp = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const response = await participantService.sendOtp(req);
    if (!response.success) {
        return (0, apiResponse_1.apiFailureResponse)(res, response.message);
    }
    return (0, apiResponse_1.apiSuccessResponse)(res, response.message, response.data);
});
exports.verifyOtp = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const response = await participantService.verifyOtp(req);
    if (!response.success) {
        return (0, apiResponse_1.apiFailureResponse)(res, response.message);
    }
    return (0, apiResponse_1.apiSuccessResponse)(res, response.message, response.data);
});
exports.resetPassword = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const response = await participantService.resetPassword(req);
    console.log({ response });
    if (!response.success) {
        return (0, apiResponse_1.apiFailureResponse)(res, response.message);
    }
    return (0, apiResponse_1.apiSuccessResponse)(res, response.message, response.data);
});
