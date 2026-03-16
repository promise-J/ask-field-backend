import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { env } from "../config/env";

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    console.log({payload})
    // req.user = payload;
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}