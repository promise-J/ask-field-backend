import { createLogger, format, transports } from "winston";
import path from "path";
import dotenv from "dotenv";

const { combine, timestamp, json, errors } = format;

// Load environment variables
dotenv.config({
  path: path.join(
    process.cwd(),
    `configs/envs/.env.${process.env.NODE_ENV}`
  ),
});

let AppLogger: any;

if (process.env.NODE_ENV === "test") {
  /**
   * For testing, disable logs
   */
  AppLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    verbose: () => {},
    silly: () => {},
    log: () => {},
  };
} else {
  // file transport options
  const fileOptions = {
    level: "error",
    filename: path.join(process.cwd(), "logs/app.log"),
    handleExceptions: true,
    json: true,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    colorize: false,
  };

  // database transport options
  const dbOptions = {
    level: "error",
    db: process.env.MONGO_URI,
    options: {
      useUnifiedTopology: true,
      useNewUrlParser: true,
    },
    collection: "logs",
    format: combine(errors({ stack: true }), timestamp(), json()),
  };

  AppLogger = createLogger({
    transports: [
      new transports.Console({
        level: "debug",
        handleExceptions: true,
        format: format.combine(
          format.colorize(),
          format.timestamp(),
          format.printf((info: any) => {
            if (!info.label) info.label = "console";
            return `${info.timestamp} [${info.label}] ${info.level}: ${info.message}`;
          })
        ),
      }),

      new transports.File(fileOptions),

      // Uncomment if using winston-mongodb
      // new MongoDB(dbOptions),
    ],
    exitOnError: false,
  });
}

export default AppLogger;