import { Request, Response, NextFunction } from "express";
import { ZodError, ZodSchema } from "zod";

/** Validates req.body (or req.query) against a zod schema and replaces it with the parsed, trimmed value. */
export const validate = (schema: ZodSchema<any>, source: "body" | "query" = "body") => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req[source] ?? {});
      if (source === "body") req.body = parsed;
      next();
    } catch (err: any) {
      if (err instanceof ZodError) {
        const messages = err.issues.map((issue) => {
          const field = issue.path.join(".");
          if (issue.code === "invalid_type" && (issue as any).input === undefined)
            return `${String(field)} is required`;
          return issue.message;
        });

        return res.status(400).json({
          success: false,
          error: messages[0],
          message: messages[0],
        });
      }

      return res.status(400).json({
        success: false,
        error: "Something went wrong.",
        message: "Something went wrong.",
      });
    }
  };
};
