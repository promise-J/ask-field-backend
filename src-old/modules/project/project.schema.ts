
export const ProjectSchemaAPI = {
    type: 'object',
    properties: {
      userId: { type: 'string' },
      title: { type: 'string' },
      participantView: { type: 'string', minLength: 8 },
      pinned: { type: 'boolean' },
      pinnedAt: { type: 'date' },
    },
    required: [
      'title',
      'userId',
      'participantView',
    ],
  };

export const CreateProjectSchemaAPI = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      participantView: { type: 'string', minLength: 8 },
    },
    required: [
      'title',
      'participantView',
    ],
  };