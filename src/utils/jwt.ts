import jwt, { JwtPayload } from 'jsonwebtoken'
import { env } from '../config';

const REFRESH_SECRET = env.REFRESH_SECRET
const ACCESS_SECRET = env.ACCESS_SECRET

export const verifyRefreshToken = (token: string)=>{
    return jwt.verify(token, REFRESH_SECRET);
}

export const signAccessToken = (payload: JwtPayload)=>{
    return jwt.sign(payload, ACCESS_SECRET, { expiresIn: "1h" });

}