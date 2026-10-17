declare namespace Express {
  interface Request {
    user?: { id: string; userType: 'participant' | 'researcher' };
  }
}
