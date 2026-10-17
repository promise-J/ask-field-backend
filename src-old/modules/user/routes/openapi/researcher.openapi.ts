export const researcherPaths = {
  "/researchers/auth/register": {
    post: {
      tags: ["Researchers"],
      summary: "Register a new researcher",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CreateResearcher" },
          },
        },
      },
      responses: {
        201: {
          description: "Researcher registered successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: {
                    type: "string",
                    example: "Registration successful",
                  },
                  data: { $ref: "#/components/schemas/Researcher" },
                },
              },
            },
          },
        },
        400: {
          description: "Error registering the researcher",
        },
      },
    },
  },
  "/researchers/auth/login": {
    post: {
      tags: ["Researchers"],
      summary: "Login a researcher",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/LoginResearcher" },
          },
        },
      },
      responses: {
        200: {
          description: "Researcher logged in successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: { type: "string", example: "Login successful" },
                  data: { $ref: "#/components/schemas/Researcher" },
                  accessToken: {
                    type: "string",
                    example:
                      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5OGM2ZjJmNjA1NmY3YWY2OWYwNThhMyIsInVzZXJUeXBlIjoiYWRtaW4iLCJpYXQiOjE3NzU1MDExNjcsImV4cCI6MTc3NjEwNTk2N30.XAfOtlmCJj8Cp8D3OBBlZG1amBCwf-1wLaN1YKGZBUs",
                  },
                  refreshToken: {
                    type: "string",
                    example:
                      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5OGM2ZjJmNjA1NmY3YWY2OWYwNThhMyIsInVzZXJUeXBlIjoiYWRtaW4iLCJpYXQiOjE3NzU1MDExNjcsImV4cCI6MTc3NjEwNTk2N30.XAfOtlmCJj8Cp8D3OBBlZG1amBCwf-1wLaN1YKGZBUs",
                  },
                },
              },
            },
          },
        },
        400: {
          description: "Error logging in the researcher",
        },
      },
    },
  },
  "/researchers/auth/verify-email": {
    get: {
      tags: ["Researchers"],
      summary: "Verify researcher email",
      parameters: [
        {
          name: "email",
          in: "query",
          required: true,
          schema: { type: "string", format: "email" },
        },
        {
          name: "token",
          in: "query",
          required: true,
          schema: { type: "string", minLength: 20 },
        },
      ],
      responses: {
        200: {
          description: "Email verified successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: {
                    type: "string",
                    example: "Email verified successfully",
                  },
                  redirect_url:
                    "https://www.joinstudy.io/waitlist?verified=true",
                },
              },
            },
          },
        },
        400: {
          description: "Error verifying the email",
        },
      },
    },
  },
  "/researchers/dashboard-stats": {
    get: {
      tags: ["Researchers"],
      summary: "Get dashboard stats for the researcher",
      // parameters: [
      //   {
      //     name: "Authorization",
      //     in: "header",
      //     required: true,
      //     schema: { type: "string", example: "Bearer <access_token>" },
      //   },
      // ],
      responses: {
        200: {
          description: "Dashboard stats fetched successfully",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: {
                    type: "string",
                    example: "Dashboard stats fetched successfully",
                  },
                  data: { $ref: "#/components/schemas/DashboardStats" },
                },
              },
            },
          },
        },
        400: {
          description: "Error fetching dashboard stats",
        },
      },
    },
  },
  "/researchers/accept-payment": {
  post: {
    tags: ["Researchers"],
    summary: "Initialize a Stripe checkout session for remittance",
    description: "Creates a Stripe Checkout Session and returns a payment URL for the foreign client.",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["amount", "email"],
            properties: {
              amount: {
                type: "number",
                description: "The payment amount in Euros (EUR)",
                example: 5000.00
              },
              email: {
                type: "string",
                format: "email",
                description: "The email address of the payer to pre-fill on Stripe Checkout",
                example: "client@example.com"
              }
            }
          }
        }
      }
    },
    responses: {
      201: {
        description: "Checkout session initialized successfully",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                message: {
                  type: "string",
                  example: "Payment session initialized successfully"
                },
                url: {
                  type: "string",
                  format: "uri",
                  description: "The hosted Stripe Checkout URL to redirect your client to",
                  example: "https://stripe.com_..."
                }
              }
            }
          }
        }
      },
      400: {
        description: "Invalid input or missing required payment fields"
      },
      500: {
        description: "Failed to communicate with Stripe gateway"
      }
    }
  }
}
};
