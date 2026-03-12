import { Response } from "express";

export function apiSuccessResponse(
    res: Response,
    message = 'Success',
    data: any,
    statusCode = 200,
  ) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
    });
  }

export function apiFailureResponse(
    res: any,
    error = '',
    statusCode = 400,
  ) {
    return res.status(statusCode).json({
      success: false,
      error
    });
  }

export function serviceResponse(success: boolean, message: string, data: any = null) {
  return {
    success,
    message,
    data
  }
}