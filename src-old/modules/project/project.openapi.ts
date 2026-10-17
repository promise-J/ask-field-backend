
export const projectPaths = {
    '/projects/create-project': {
      post: {
        tags: ['Projects'],
        summary: 'Create a new project',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateProject' },
            },
          },
        },
        responses: {
          201: {
            description: 'Project created successfully',
            content: {
              'application/json': {
                schema: { 
                  type: 'object',
                  properties: {
                    message: {type: 'string', example: 'Project created successfully'},
                    data: {$ref: '#/components/schemas/Project'},
                  }
                },
              },
            },
          },
          400: {
              description: "Error creating the project"
          }
        },
      },
    },
    '/projects/list-user-projects': {
      get: {
        tags: ['Projects'],
        summary: "Fetch all user's projects",
        parameters: [
            {
              name: 'page',
              in: 'query',
              required: true,
              schema: { type: 'string', format: 'number', minimum: 1 },
            },
            {
              name: 'limit',
              in: 'query',
              required: true,
              schema: { type: 'string', format: 'number', minimum: 1 },
            },
        ],
        responses: {
          201: {
            description: 'Projects fetched successfully',
            content: {
              'application/json': {
                schema: { 
                  type: 'object',
                  properties: {
                    message: {type: 'string', example: 'Project fetched successfully'},
                    data: {
                        type: 'array',
                        items: {
                            $ref: '#/components/schemas/Project'
                        }
                    },
                  }
                },
              },
            },
          },
          400: {
              description: "Error fetching the project"
          }
        },
      },
    },
    '/projects/get-project:/id': {
      get: {
        tags: ['Projects'],
        summary: "Fetch user's project by id",
        parameters: [
            {
              name: 'id',
              in: 'params',
              required: true,
              schema: { type: 'string' },
              description: 'Project ID',
            },
        ],
        responses: {
          201: {
            description: 'Project fetched successfully',
            content: {
              'application/json': {
                schema: { 
                  type: 'object',
                  properties: {
                    message: {type: 'string', example: 'Project fetched successfully'},
                    data: {
                       $ref: '#/components/schemas/Project'
                    },
                  }
                },
              },
            },
          },
          400: {
              description: "Error fetching the project"
          }
        },
      },
    },
    '/projects/rename-project:/id': {
      put: {
        tags: ['Projects'],
        summary: "Raname user's project by id",
        parameters: [
            {
              name: 'id',
              in: 'params',
              required: true,
              schema: { type: 'string' },
              description: 'Project ID',
            },
        ],
        requestBody: {
            required: true,
            content: {
                'application/json': {
                schema: { 
                    type: 'object',
                    properties: {
                    title: {type: 'string', example: 'New Project Title'},
                    }
                },
                },
            },
        },
        responses: {
          201: {
            description: 'Project renamed successfully',
            content: {
              'application/json': {
                schema: { 
                  type: 'object',
                  properties: {
                    message: {type: 'string', example: 'Project renamed successfully'},
                    // data: {
                    //    $ref: '#/components/schemas/Project'
                    // },
                  }
                },
              },
            },
          },
          400: {
              description: "Error fetching the project"
          }
        },
      },
    },
    '/projects/pin-project:/id': {
      put: {
        tags: ['Projects'],
        summary: "pin user's project by id",
        parameters: [
            {
              name: 'id',
              in: 'params',
              required: true,
              schema: { type: 'string' },
              description: 'Project ID',
            },
        ],
        responses: {
          201: {
            description: 'Project pinned successfully',
            content: {
              'application/json': {
                schema: { 
                  type: 'object',
                  properties: {
                    message: {type: 'string', example: 'Project pinned successfully'},
                    // data: {
                    //    $ref: '#/components/schemas/Project'
                    // },
                  }
                },
              },
            },
          },
          400: {
              description: "Error fetching the project"
          }
        },
      },
    },
    '/projects/delete-project:/id': {
      delete: {
        tags: ['Projects'],
        summary: "delete user's project by id",
        parameters: [
            {
              name: 'id',
              in: 'params',
              required: true,
              schema: { type: 'string' },
              description: 'Project ID',
            },
        ],
        responses: {
          201: {
            description: 'Project deleted successfully',
            content: {
              'application/json': {
                schema: { 
                  type: 'object',
                  properties: {
                    message: {type: 'string', example: 'Project deleted successfully'},
                  }
                },
              },
            },
          },
          400: {
              description: "Error fetching the project"
          }
        },
      },
    },
}