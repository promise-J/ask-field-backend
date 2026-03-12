"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = void 0;
const zod_1 = require("zod");
const validate = (schema) => {
    return (req, res, next) => {
        try {
            schema.parse(req.body); // Will throw if validation fails
            next(); // Continue to the controller
        }
        catch (err) {
            if (err instanceof zod_1.ZodError) {
                // Zod puts all issues in `err.issues`
                const messages = err.issues.map((issue) => {
                    const field = issue.path[0];
                    if (issue.code === "invalid_type")
                        return `${String(field)} is required`;
                    return issue.message;
                });
                // Return only the first error
                return res.status(400).json({
                    success: false,
                    message: messages[0]
                });
            }
            return res.status(400).json({
                success: false,
                message: "Something went wrong.",
            });
        }
    };
};
exports.validate = validate;
