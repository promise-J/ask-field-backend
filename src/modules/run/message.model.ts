import { Schema, model, Types } from 'mongoose';

/**
 * Stage 6: messages about one study, between its researcher and its participants.
 * `participantId` is the thread; a message to everyone taking part is stored once per recipient,
 * marked `broadcast`, so each participant sees it in their own thread.
 */
const messageSchema = new Schema(
  {
    surveyId: { type: Types.ObjectId, ref: 'Survey', required: true, index: true },
    researcherId: { type: Types.ObjectId, ref: 'Researcher', required: true, index: true },
    participantId: { type: Types.ObjectId, ref: 'Participant', required: true, index: true },
    from: { type: String, enum: ['researcher', 'participant'], required: true },
    body: { type: String, required: true, maxlength: 4000 },
    broadcast: { type: Boolean, default: false },
    readAt: Date, // read by the other side
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_d: unknown, ret: Record<string, any>) => {
        ret.messageId = String(ret._id);
        for (const k of ['_id', 'surveyId', 'researcherId', 'participantId']) if (ret[k]) ret[k] = String(ret[k]);
        delete ret.__v;
        return ret;
      },
    },
  }
);
messageSchema.index({ surveyId: 1, participantId: 1, createdAt: 1 });

export const MessageModel = model('Message', messageSchema);
