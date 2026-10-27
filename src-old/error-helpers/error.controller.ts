import { NextFunction, Request, Response } from "express";
import logger from "../config/logger";
import MongoDBError from "./mongoDBError";

/**
 * Error handling middleware at the application level.
 * Every error response has { success: false, status, error, message } so the frontend can show `error` or `message`.
 * Known database errors become friendly 4xx messages; unexpected errors are logged and hidden in production.
 */
export default (err: any, req: Request, res: Response, _next: NextFunction) => {
    let error = err;
    if (error?.name === "ValidationError" && error.errors) error = MongoDBError.handleValidationError(error);
    else if (error?.name === "CastError") error = MongoDBError.handleCastError(error);
    else if (error?.code === 11000) error = MongoDBError.handleDuplicateField(error);
    else if (error?.type === "entity.parse.failed") error = { statusCode: 400, isOperational: true, message: "The request body isn't valid JSON." };

    const statusCode = Number(error.statusCode) || 500;
    const operational = Boolean(error.isOperational) || statusCode < 500;

    if (!operational) logger.error({ err }, "Unhandled error");
    if (process.env.DEBUG_ERRORS && !operational) console.error(err);

    const message =
        operational || process.env.NODE_ENV === "development"
            ? error.message || "Something went wrong!"
            : "Something went wrong!";

    res.status(statusCode).json({
        success: false,
        status: `${statusCode}`.startsWith("4") ? "fail" : "error",
        error: message,
        message,
        ...(operational && typeof error.code === "string" ? { code: error.code } : {}),
        ...(operational && error.data ? { data: error.data } : {}),
    });
};
