declare namespace Express {
  interface Request {
    /**
     * `id` is whose data the request works on: for researchers, the workspace (its owner's account).
     * `selfId` is who is signed in. `role` is their role in that workspace (Stage 9).
     */
    user?: { id: string; userType: 'participant' | 'researcher'; selfId?: string; iat?: number; sid?: string; at?: number; role?: 'owner' | 'admin' | 'researcher' | 'viewer' };
  }
}
