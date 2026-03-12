"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
/**
 * Global API rate limiter
 * Prevents brute-force & abuse attacks
 */
exports.rateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per window
    standardHeaders: true, // return rate limit info in RateLimit-* headers
    legacyHeaders: false, // disable X-RateLimit-* headers
    message: {
        success: false,
        message: 'Too many requests, please try again later.',
    },
});
