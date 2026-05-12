export const surveyPaths = {
  "surveys/create-draft-survey": {
    post: {
      tags: ["Surveys"],
      summary: "Create a new draft survey",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                projectId: {
                  type: "string",
                  pattern: "^[0-9a-fA-F]{24}$",
                  example: "60c72b2f9b1d8e5a5c8f9e7a",
                },
                surveyName: {
                  type: "string",
                  example: "Customer Satisfaction Survey",
                },
              },
              required: ["projectId"],
            },
          },
        },
      },
      responses: {
        201: {
          description: "Draft survey created successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: {
                    type: "string",
                    example: "Draft survey created successfully",
                  },
                  data: {
                    type: "object",
                    properties: {
                      surveyId: {
                        type: "string",
                        example: "60c72b2f9b1d8e5a5c8f9e7a",
                      },
                      projectId: {
                        type: "string",
                        example: "60c72b2f9b1d8e5a5c8f9e7a",
                      },
                      userId: {
                        type: "string",
                        example: "60c72b2f9b1d8e5a5c8f9e7a",
                      },
                      surveyName: {
                        type: "string",
                        example: "Customer Satisfaction Survey",
                      },
                      status: { type: "string", example: "draft" },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: "Error creating the draft survey",
        },
      },
    },
  },
  "surveys/publish-draft-survey/:surveyId": {
    post: {
      tags: ["Surveys"],
      summary: "Publish a draft survey",
      parameters: [
        {
          name: "surveyId",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "The ID of the draft survey to publish",
        },
      ],
      responses: {
        200: {
          description: "Survey published successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: {
                    type: "string",
                    example: "Survey published successfully",
                  },
                  data: {
                    $ref: "#/components/schemas/Survey",
                  },
                },
              },
            },
          },
        },
        400: {
          description: "Error publishing the survey",
        },
      },
    },
  },
  "surveys/update-draft-survey/:surveyId": {
    put: {
      tags: ["Surveys"],
      summary: "Update a draft survey",
      parameters: [
        {
          name: "surveyId",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "The ID of the draft survey to update",
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Survey" },
          },
        },
      },
      responses: {
        200: {
          description: "Draft survey updated successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: {
                    type: "string",
                    example: "Draft survey updated successfully",
                  },
                  data: {
                    $ref: "#/components/schemas/Survey",
                  },
                },
              },
            },
          },
        },
        400: {
          description: "Error updating the draft survey",
        },
      },
    },
  },
  "/surveys/get-surveys-by-project/:projectId": {
    get: {
      tags: ["Surveys"],
      summary: "Fetch all surveys of a project",
      parameters: [
        {
          name: "projectId",
          in: "params",
          required: true,
          schema: { type: "string" },
          description: "The ID of the project to fetch surveys for",
        },
        {
          name: "status",
          in: "query",
          required: true,
          schema: { type: "string", example: "published | draft | closed" },
          description: "The status of the project to fetch surveys for",
        },
      ],
      responses: {
        201: {
          description: "Surveys fetched successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: {
                    type: "string",
                    example: "Surveys fetched successfully",
                  },
                  data: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Survey" },
                  },
                },
              },
            },
          },
        },
        400: {
          description: "Error fetching the surveys",
        },
      },
    },
  },
  "/surveys/get-user-survey/:surveyId": {
    get: {
      tags: ["Surveys"],
      summary: "Fetch a survey by its ID",
      parameters: [
        {
          name: "surveyId",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "The ID of the survey to fetch",
        },
      ],
      responses: {
        201: {
          description: "Survey fetched successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: {
                    type: "string",
                    example: "Survey fetched successfully",
                  },
                  data: {
                    $ref: "#/components/schemas/Survey",
                  },
                },
              },
            },
          },
        },
        400: {
          description: "Error fetching the survey",
        },
      },
    },
  },
  "/surveys/check-eligibility/:surveyId": {
    get: {
      tags: ["Surveys"],
      summary: "Check eligibility for a survey",
      parameters: [
        {
          name: "surveyId",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "The ID of the survey to check eligibility for",
        },
      ],
      responses: {
        200: {
          description: "Eligibility checked successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: {
                    type: "string",
                    example: "Eligibility checked successfully",
                  },
                  data: {
                    eligible: { type: "boolean", example: true },
                    reason: {
                      type: "string",
                      example: "User is eligible for the survey",
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: "Error checking eligibility",
        },
      },
    },
  },
  "/surveys/create-survey-action": {
    post: {
      tags: ["Surveys"],
      summary: "Create a survey action",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["surveyId"],
              properties: {
                surveyId: {
                  type: "string",
                  example: "689abced1234567890abcd12",
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Survey action created successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  message: {
                    type: "string",
                    example: "Survey action created successfully.",
                  },
                  data: {
                    $ref: "#/components/schemas/SurveyAction",
                  },
                },
              },
            },
          },
        },
        400: {
          description: "Error creating survey action",
        },
      },
    },
  },
  "/surveys/list-survey-actions": {
    get: {
      tags: ["Surveys"],
      summary:
        "List all survey actions belonging to surveys created by the researcher",
      responses: {
        200: {
          description: "Survey actions fetched successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  message: {
                    type: "string",
                    example: "Survey actions fetched successfully.",
                  },
                  data: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/SurveyAction",
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: "Error fetching survey actions",
        },
      },
    },
  },
  "/surveys/get-survey-actions/:surveyActionId": {
    get: {
      tags: ["Surveys"],
      summary: "Get a survey action by ID",
      parameters: [
        {
          name: "surveyActionId",
          in: "path",
          required: true,
          schema: {
            type: "string",
          },
          description: "Survey action ID",
        },
      ],
      responses: {
        200: {
          description: "Survey action fetched successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: {
                    type: "boolean",
                    example: true,
                  },
                  message: {
                    type: "string",
                    example: "Survey action fetched successfully.",
                  },
                  data: {
                    $ref: "#/components/schemas/SurveyAction",
                  },
                },
              },
            },
          },
        },
        404: {
          description: "Survey action not found",
        },
      },
    },
  },
  "/surveys/verify-survey-action/:surveyActionId": {
    patch: {
      tags: ["Surveys"],
      summary: "Submit a survey action for review",
      parameters: [
        {
          name: "surveyActionId",
          in: "path",
          required: true,
          schema: {
            type: "string",
          },
          description: "Survey action ID",
        },
      ],
      responses: {
        200: {
          description: "Survey submitted successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: {
                    type: "boolean",
                    example: true,
                  },
                  message: {
                    type: "string",
                    example:
                      "Survey submitted successfully and is awaiting review.",
                  },
                  data: {
                    $ref: "#/components/schemas/SurveyAction",
                  },
                },
              },
            },
          },
        },
        404: {
          description: "Survey not found",
        },
      },
    },
  },
  "/surveys/approve-survey-action/:surveyActionId": {
    patch: {
      tags: ["Surveys"],
      summary: "Approve a survey action",
      parameters: [
        {
          name: "surveyActionId",
          in: "path",
          required: true,
          schema: {
            type: "string",
          },
          description: "Survey action ID",
        },
      ],
      responses: {
        200: {
          description: "Survey approved successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: {
                    type: "boolean",
                    example: true,
                  },
                  message: {
                    type: "string",
                    example: "Survey has been approved successfully",
                  },
                  data: {
                    $ref: "#/components/schemas/SurveyAction",
                  },
                },
              },
            },
          },
        },
        404: {
          description: "Survey not found",
        },
      },
    },
  },
  "/surveys/reject-survey-actions/:surveyActionId": {
    patch: {
      tags: ["Surveys"],
      summary: "Reject a survey action",
      parameters: [
        {
          name: "surveyActionId",
          in: "path",
          required: true,
          schema: {
            type: "string",
          },
          description: "Survey action ID",
        },
      ],
      responses: {
        200: {
          description: "Survey rejected successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: {
                    type: "boolean",
                    example: true,
                  },
                  message: {
                    type: "string",
                    example: "Survey has been rejected successfully",
                  },
                  data: {
                    $ref: "#/components/schemas/SurveyAction",
                  },
                },
              },
            },
          },
        },
        404: {
          description: "Survey not found",
        },
      },
    },
  },
};
