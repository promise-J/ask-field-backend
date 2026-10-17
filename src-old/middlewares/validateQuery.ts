import { Request, Response, NextFunction } from "express";
import { ZodError, ZodSchema } from "zod";

export const validateQuery = (schema: ZodSchema<any>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate req.query instead of req.body
      schema.parse(req.query);
      next();
    } catch (err: any) {
      if (err instanceof ZodError) {
        const messages = err.issues.map((issue) => {
          const field = issue.path[0];
          if (issue.code === "invalid_type")
            return `${String(field)} is required`;
          return issue.message;
        });

        return res.status(400).json({
          success: false,
          message: messages[0],
        });
      }

      return res.status(400).json({
        success: false,
        message: "Something went wrong.",
      });
    }
  };
};