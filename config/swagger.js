// Swagger/OpenAPI configuration
const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Wampums Scout Management API',
      version: '1.0.0',
      description: 'RESTful API for Scout management application',
      contact: {
        name: 'API Support',
        email: 'info@christiansabourin.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server'
      },
      {
        url: 'https://api.production.com',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT token obtained from login endpoint'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            message: {
              type: 'string',
              example: 'Error message'
            },
            timestamp: {
              type: 'string',
              format: 'date-time'
            }
          }
        },
        Success: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            message: {
              type: 'string',
              example: 'Operation successful'
            },
            data: {
              type: 'object'
            },
            timestamp: {
              type: 'string',
              format: 'date-time'
            }
          }
        },
        Participant: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              example: 1
            },
            first_name: {
              type: 'string',
              example: 'John'
            },
            last_name: {
              type: 'string',
              example: 'Doe'
            },
            date_of_birth: {
              type: 'string',
              format: 'date',
              example: '2010-05-15'
            },
            group_id: {
              type: 'integer',
              nullable: true,
              example: 1
            },
            group_name: {
              type: 'string',
              nullable: true,
              example: 'Les Loups'
            }
          }
        },
        Group: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              example: 1
            },
            name: {
              type: 'string',
              example: 'Les Loups'
            },
            organization_id: {
              type: 'integer',
              example: 1
            },
            member_count: {
              type: 'integer',
              example: 6
            },
            total_points: {
              type: 'number',
              example: 45.5
            }
          }
        },
        Attendance: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              example: 1
            },
            participant_id: {
              type: 'integer',
              example: 1
            },
            date: {
              type: 'string',
              format: 'date',
              example: '2025-01-15'
            },
            status: {
              type: 'string',
              enum: ['present', 'absent', 'late', 'excused'],
              example: 'present'
            },
            first_name: {
              type: 'string',
              example: 'John'
            },
            last_name: {
              type: 'string',
              example: 'Doe'
            }
          }
        }
      },
      responses: {
        UnauthorizedError: {
          description: 'Access token is missing or invalid',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        ForbiddenError: {
          description: 'Insufficient permissions',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        NotFoundError: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        }
      }
    },
    tags: [
      {
        name: 'Participants',
        description: 'Participant management endpoints'
      },
      {
        name: 'Groups',
        description: 'Group management endpoints'
      },
      {
        name: 'Attendance',
        description: 'Attendance tracking endpoints'
      },
      {
        name: 'Points',
        description: 'Points and honors system'
      },
      {
        name: 'Forms',
        description: 'Form submissions and templates'
      },
      {
        name: 'Reports',
        description: 'Reporting endpoints'
      }
    ]
  },
  apis: ['./routes/*.js', './api.js']
};

const specs = swaggerJsdoc(options);

module.exports = specs;
