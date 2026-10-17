import mongoose from "mongoose";
import AppError from "./appError";

/**
 * @class group error handlers related to MongoDB.
 */
class MongoDBError {
    /** Handles errors related to duplicated keys/indexes. */
    static handleDuplicateField(err: any) {
        const field = Object.keys(err.keyValue || {})[0];
        const message = field
            ? `An account or record with this ${field} already exists.`
            : "This record already exists.";
        return new AppError(message, 409);
    }

    /** Handles casting errors for invalid ObjectId, strings, numbers. */
    static handleCastError(err: any) {
        const message = `Invalid ${err.path}: ${err.value}`;
        return new AppError(message, 400);
    }

    /** Handles field validation errors. */
    static handleValidationError(err: mongoose.Error.ValidationError) {
        const errors = Object.values(err.errors).map((obj) => obj.message ?? "");
        const message = `Invalid input data. ${errors.join(". ")}`;
        return new AppError(message, 400);
    }
}

export default MongoDBError;
