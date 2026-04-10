
export const surveySchemaAPI = {
    type: "object",
    properties: {
      userId: { type: "string", pattern: "^[0-9a-fA-F]{24}$" }, // Mongo ObjectId
      projectId: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
      surveyType: { type: "string" },
      surveyName: { type: "string" },
      internalSurveyName: { type: "string" },
      surveyDescription: { type: "string" },
      surveyLabel: { type: "string" },
      usableDevices: {
        type: "array",
        items: { type: "string" },
      },
      surveyEquipment: { type: "string" },
      contentWarning: { type: "string" },
      surveyURL: { type: "string", format: "uri" },
      toRecordId: { type: "string" },
      handleSubmission: { type: "string" },
      addToParticipantGroup: { type: "string" },
      howToFindParticipant: { type: "string" },
      numberOfParticipants: { type: "number" },
      howToScreenParticipants: { type: "string" },
      surveyDistribution: { type: "string" },
      status: { type: "string" },
      surveyCrendentials: { type: "string" },
      totalSubmission: { type: "number" },
      inputRejection: { type: "number" },
      surveyDuration: { type: "number" },
      surveyAmount: { type: "number" },
    },
    required: [
      "userId",
      "projectId",
      "surveyType",
      "surveyName",
      "surveyDescription",
      "surveyLabel",
      "usableDevices",
      "surveyEquipment",
      "contentWarning",
      "surveyURL",
      "toRecordId",
      "handleSubmission",
      "addToParticipantGroup",
      "howToFindParticipant",
      "numberOfParticipants",
      "howToScreenParticipants",
      "surveyDistribution",
      "surveyCrendentials",
      "totalSubmission",
      "inputRejection",
      "surveyDuration",
      "surveyAmount",
    ],
};

export const createDraftSurveySchemaAPI = {
  type: "object",
  properties: {
    projectId: { type: "string", pattern: "^[0-9a-fA-F]{24}$", example: "60c72b2f9b1d8e5a5c8f9e7a" },
  }
}