import { Schema, model, Types } from 'mongoose';

/** Stage 6: one participant's place in an interview or focus-group session. */
const bookingSchema = new Schema(
  {
    surveyId: { type: Types.ObjectId, ref: 'Survey', required: true, index: true },
    researcherId: { type: Types.ObjectId, ref: 'Researcher', required: true, index: true },
    participantId: { type: Types.ObjectId, ref: 'Participant', required: true, index: true },
    surveyActionId: { type: Types.ObjectId, ref: 'SurveyAction', required: true },
    start: { type: Date, required: true, index: true },
    end: { type: Date, required: true },
    status: { type: String, enum: ['booked', 'cancelled', 'happened', 'noshow'], default: 'booked', index: true },
    participantTz: { type: String, default: 'Africa/Lagos' },
    videoUrl: { type: String, default: '' }, // per-booking link (when the researcher chose "a new link each time")
    reminded24: Date,
    reminded1: Date,
    attendanceReminded: Date, // Stage 7: the day-after nudge to mark it
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_d: unknown, ret: Record<string, any>) => {
        ret.bookingId = String(ret._id);
        for (const k of ['_id', 'surveyId', 'researcherId', 'participantId', 'surveyActionId']) if (ret[k]) ret[k] = String(ret[k]);
        delete ret.__v;
        return ret;
      },
    },
  }
);

export const BookingModel = model('Booking', bookingSchema);
