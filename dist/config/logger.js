"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pino_1 = __importDefault(require("pino"));
const env_1 = require("./env");
const logger = (0, pino_1.default)({
    level: env_1.env.NODE_ENV === 'production' ? 'info' : 'debug',
});
exports.default = logger;
