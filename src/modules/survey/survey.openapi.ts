
export const surveyPaths = {
    // "/surveys/create-survey": {
    //   post: {
    //     tags: ["Surveys"],
    //     summary: "Register a new survey",
    //     requestBody: {
    //       required: true,
    //       content: {
    //         "application/json": {
    //           schema: { $ref: "#/components/schemas/Survey" },
    //         },
    //       },
    //     },
    //     responses: {
    //       201: {
    //         description: "Survey registered successfully",
    //         content: {
    //           "application/json": {
    //             schema: {
    //               type: 'object',
    //               properties: {
    //                 message: {type: "string", example: "Survey has been created"},
    //                 data: {
    //                   $ref: '#/components/schemas/Survey'
    //                 }
    //               }
    //             },
    //           },
    //         },
    //       },
    //       400: {
    //         description: "Error registering the survey",
    //       },
    //     },
    //   },
    // },
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
                  projectId: { type: "string", pattern: "^[0-9a-fA-F]{24}$", example: "60c72b2f9b1d8e5a5c8f9e7a" },
                  surveyName: {type: "string", example: "Customer Satisfaction Survey"},
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
                  type: 'object',
                  properties: {
                    message: {type: "string", example: "Draft survey created successfully"},
                    data: {
                      type: 'object',
                      properties: {
                        surveyId: { type: "string", example: "60c72b2f9b1d8e5a5c8f9e7a" },
                        projectId: { type: "string", example: "60c72b2f9b1d8e5a5c8f9e7a" },
                        userId: { type: "string", example: "60c72b2f9b1d8e5a5c8f9e7a" },
                        surveyName: {type: "string", example: "Customer Satisfaction Survey"},
                        status: {type: "string", example: "draft"},
                      }
                    }
                  }
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
                  type: 'object',
                  properties: {
                    message: {type: "string", example: "Survey published successfully"},
                    data: {
                      $ref: '#/components/schemas/Survey'
                    }
                  }
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
                  type: 'object',
                  properties: {
                    message: {type: "string", example: "Draft survey updated successfully"},
                    data: {
                      $ref: '#/components/schemas/Survey'
                    }
                  }
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
            schema: { type: "string", example: 'published | draft | closed' },
            description: "The status of the project to fetch surveys for",
          },
        ],
        responses: {
          201: {
            description: "Surveys fetched successfully",
            content: {
              "application/json": {
                schema: {
                  type: 'object',
                  properties: {
                    message: {type: "string", example: "Surveys fetched successfully"},
                    data: {
                      type: 'array',
                      items: {$ref: '#/components/schemas/Survey'}
                    }
                  }
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
                  type: 'object',
                  properties: {
                    message: {type: "string", example: "Survey fetched successfully"},
                    data: {
                      $ref: '#/components/schemas/Survey'
                    }
                  }
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
    "/surveys/update-draft-survey/:surveyId": {
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
                  type: 'object',
                  properties: {
                    message: {type: "string", example: "Draft survey updated successfully"},
                    data: {
                      $ref: '#/components/schemas/Survey'
                    }
                  }
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
}