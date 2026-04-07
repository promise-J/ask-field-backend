

export const participantPaths = {
  '/participants/auth/register': {
    post: {
      tags: ['Participants'],
      summary: 'Register a new participant',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateParticipant' },
          },
        },
      },
      responses: {
        201: {
          description: 'Participant registered successfully',
          content: {
            'application/json': {
              schema: { 
                type: 'object',
                properties: {
                  message: {type: 'string', example: 'Registration successful'},
                  data: {$ref: '#/components/schemas/Participant'},
                }
              },
            },
          },
        },
        400: {
            description: "Error registering the participant"
        }
      },
    },
  },
  '/participants/auth/login': {
    post: {
      tags: ['Participants'],
      summary: 'Login a participant',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/LoginParticipant' },
          },
        },
      },
      responses: {
        200: {
          description: 'Participant logged in successfully',
          content: {
            'application/json': {
              schema: { 
                type: 'object',
                properties: {
                    message: {type: 'string', example: 'Login successful'},
                    data: {$ref: '#/components/schemas/Participant'},
                    accessToken: {type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5OGM2ZjJmNjA1NmY3YWY2OWYwNThhMyIsInVzZXJUeXBlIjoiYWRtaW4iLCJpYXQiOjE3NzU1MDExNjcsImV4cCI6MTc3NjEwNTk2N30.XAfOtlmCJj8Cp8D3OBBlZG1amBCwf-1wLaN1YKGZBUs'},
                    refreshToken: {type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5OGM2ZjJmNjA1NmY3YWY2OWYwNThhMyIsInVzZXJUeXBlIjoiYWRtaW4iLCJpYXQiOjE3NzU1MDExNjcsImV4cCI6MTc3NjEwNTk2N30.XAfOtlmCJj8Cp8D3OBBlZG1amBCwf-1wLaN1YKGZBUs'},
                } 
              },
            },
          },
        },
        400: {
            description: "Error logging in the participant"
        }
      },
    },
  },
  '/participants/auth/verify-email': {
    get: {
      tags: ['Participants'],
      summary: 'Verify participant email',
      parameters: [
        {
          name: 'email',
          in: 'query',
          required: true,
          schema: { type: 'string', format: 'email' },
        },
        {
          name: 'token',
          in: 'query',
          required: true,
          schema: { type: 'string', minLength: 20 },
        },
      ],
      responses: {
        200: {
          description: 'Email verified successfully',
          content: {
            'application/json': {
              schema: { 
                type: 'object',
                properties: {
                    message: {type: 'string', example: 'Email verified successfully'},
                    redirect_url: "https://www.joinstudy.io/waitlist?verified=true",
                } 
              },
            },
          },
        },
        400: {
            description: "Error verifying the email"
        }
      },
    },
  },
  '/participants/auth/google-auth': {
    post: {
      tags: ['Participants'],
      summary: 'Authenticate a participant using Google',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/GoogleAuthParticipant' },
          },
        },
      },
      responses: {
        200: {
          description: 'Participant authenticated successfully',
          content: {
            'application/json': {
              schema: { 
                type: 'object',
                properties: {
                    message: {type: 'string', example: 'Authentication successful'},
                    data: {$ref: '#/components/schemas/Participant'},
                    accessToken: {type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5OGM2ZjJmNjA1NmY3YWY2OWYwNThhMyIsInVzZXJUeXBlIjoiYWRtaW4iLCJpYXQiOjE3NzU1MDExNjcsImV4cCI6MTc3NjEwNTk2N30.XAfOtlmCJj8Cp8D3OBBlZG1amBCwf-1wLaN1YKGZBUs'},
                    refreshToken: {type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5OGM2ZjJmNjA1NmY3YWY2OWYwNThhMyIsInVzZXJUeXBlIjoiYWRtaW4iLCJpYXQiOjE3NzU1MDExNjcsImV4cCI6MTc3NjEwNTk2N30.XAfOtlmCJj8Cp8D3OBBlZG1amBCwf-1wLaN1YKGZBUs'},
                } 
              },
            },
          },
        },
        400: {
            description: "Error authenticating the participant"
        }
      },
    },
  },
  '/participants/auth/refresh-token': {
    get: {
      tags: ['Participants'],
      summary: 'Refresh access token using refresh token',
      parameters: [
        {
          name: 'refresh-token',
          in: 'header',
          required: true,
          schema: { type: 'string' },
          description: 'Refresh token provided by the client',
        },
      ],
      responses: {
        200: {
          description: 'Access token refreshed successfully',
          content: {
            'application/json': {
              schema: { 
                type: 'object',
                properties: {
                    message: {type: 'string', example: 'Token refreshed successfully'},
                    accessToken: {type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5OGM2ZjJmNjA1NmY3YWY2OWYwNThhMyIsInVzZXJUeXBlIjoiYWRtaW4iLCJpYXQiOjE3NzU1MDExNjcsImV4cCI6MTc3NjEwNTk2N30.XAfOtlmCJj8Cp8D3OBBlZG1amBCwf-1wLaN1YKGZBUs'},
                } 
              },
            },
          },
        },
        400: {
            description: "Error refreshing the token"
        }
      },
    },
  },
  '/participants/auth/send-otp': {
    post: {
      tags: ['Participants'],
      summary: 'Send OTP to participant email',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/SendOtpParticipant' },
          },
        },
      },
      responses: {
        200: {
          description: 'OTP sent successfully',
          content: {
            'application/json': {
              schema: { 
                type: 'object',
                properties: {
                    message: {type: 'string', example: 'OTP sent successfully'},
                } 
              },
            },
          },
        },
        400: {
            description: "Error sending OTP"
        }
      },
    },
  },
  '/participants/auth/verify-otp': {
    post: {
      tags: ['Participants'],
      summary: 'Verify OTP for participant email',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/VerifyOtpParticipant' },
          },
        },
      },
      responses: {
        200: {
          description: 'OTP verified successfully',
          content: {
            'application/json': {
              schema: { 
                type: 'object',
                properties: {
                    message: {type: 'string', example: 'OTP verified successfully'},
                } 
              },
            },
          },
        },
        400: {
            description: "Error verifying OTP"
        }
      },
    },
  },
  '/participants/auth/reset-password': {
    post: {
      tags: ['Participants'],
      summary: 'Reset participant password using OTP',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ResetPasswordParticipant' },
          },
        },
      },
      responses: {
        200: {
          description: 'Password reset successfully',
          content: {
            'application/json': {
              schema: { 
                type: 'object',
                properties: {
                    message: {type: 'string', example: 'Password reset successfully'},
                } 
              },
            },
          },
        },
        400: {
            description: "Error resetting password"
        }
      },
    },
  },
};