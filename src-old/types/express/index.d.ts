// src/types/express/index.d.ts
import { JwtPayload } from "jsonwebtoken";
import { IParticipant } from "../../modules/user/models/participant.model";


declare global {
  namespace Express {
    interface Request {
      user?: {id: string, userType: string};
    }
  }
}

// Keep this to ensure the file is treated as a module
export {}; 
