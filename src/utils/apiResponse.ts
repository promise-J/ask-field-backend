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

/** Failure responses always carry success: false plus `error` and `message`, which the frontend's formatApiError reads. */
export function apiFailureResponse(
    res: Response,
    error = 'Something went wrong.',
    statusCode = 400,
  ) {
    return res.status(statusCode).json({
      success: false,
      error,
      message: error,
    });
  }

export function serviceResponse(success: boolean, message: string, data: any = null) {
  return {
    success,
    message,
    data
  }
}
