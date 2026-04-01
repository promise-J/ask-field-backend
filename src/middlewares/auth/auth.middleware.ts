import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";

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
    const payload = jwt.verify(token, env.ACCESS_SECRET) as {id: string, userType: string};
    req.user = payload;
    next();
  } catch(error) {
    res.status(401).json({ message: error });
    // res.status(401).json({ message: "Invalid token" });
  }
}