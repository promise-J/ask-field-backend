import { Request, Response, NextFunction } from "express";
import { ZodError, ZodSchema } from "zod";

export const validate = (schema: ZodSchema<any>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body); // Will throw if validation fails
      next(); // Continue to the controller
    } catch (err: any) {
      if (err instanceof ZodError) {
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
          error: messages[0]
        });
      }

      return res.status(400).json({
        success: false,
        error: "Something went wrong.",
      });
    }
  };
};
