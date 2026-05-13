import { NextFunction, Request, Response } from "express";
import { authMiddleware } from "./auth.middleware";

function participantAuth(req: Request, res: Response, next: NextFunction){
    try {
        authMiddleware(req, res, ()=> {
            if(req.user?.userType !== "researcher"){
                return res.status(403).json({ message: "Forbidden! Participant Only" });
            }
            next();
        })
    } catch (error) {
        return res.status(403).json({ message: "Forbidden! Participant Only" });
    }
}

export default participantAuth;