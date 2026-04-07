
export const surveyPaths = {
    "/surveys/auth/register": {
      post: {
        tags: ["Surveys"],
        summary: "Register a new survey",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Survey" },
            },
          },
        },
        responses: {
          201: {
            description: "Survey registered successfully",
            content: {
              "application/json": {
                schema: {
                  type: 'object',
                  properties: {
                    message: {type: "string", example: "Survey has been created"}
                  }
                },
              },
            },
          },
          400: {
            description: "Error registering the survey",
          },
        },
      },
    },
}