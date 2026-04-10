"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = require("winston");
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const config_1 = require("../config");
const { combine, timestamp, json, errors } = winston_1.format;
// Load environment variables
dotenv_1.default.config({
    path: path_1.default.join(process.cwd(), `configs/envs/.env.${config_1.env.NODE_ENV}`),
});
let AppLogger;
if (config_1.env.NODE_ENV === "test") {
    /**
     * For testing, disable logs
     */
    AppLogger = {
        info: () => { },
        warn: () => { },
        error: () => { },
        debug: () => { },
        verbose: () => { },
        silly: () => { },
        log: () => { },
    };
}
else {
    // file transport options
    const fileOptions = {
        level: "error",
        filename: path_1.default.join(process.cwd(), "logs/app.log"),
        handleExceptions: true,
        json: true,
        maxsize: 5242880, // 5MB
        maxFiles: 5,
        colorize: false,
    };
    // database transport options
    const dbOptions = {
        level: "error",
        db: config_1.env.MONGO_URL,
        options: {
            useUnifiedTopology: true,
            useNewUrlParser: true,
        },
        collection: "logs",
        format: combine(errors({ stack: true }), timestamp(), json()),
    };
    AppLogger = (0, winston_1.createLogger)({
        transports: [
            new winston_1.transports.Console({
                level: "debug",
                handleExceptions: true,
                format: winston_1.format.combine(winston_1.format.colorize(), winston_1.format.timestamp(), winston_1.format.printf((info) => {
                    if (!info.label)
                        info.label = "console";
                    return `${info.timestamp} [${info.label}] ${info.level}: ${info.message}`;
                })),
            }),
            new winston_1.transports.File(fileOptions),
            // Uncomment if using winston-mongodb
            // new MongoDB(dbOptions),
        ],
        exitOnError: false,
    });
}
exports.default = AppLogger;
