import { Schema, model, Types } from 'mongoose';

/**
 * Stage 9: someone's place in another researcher's workspace. A workspace is its owner's account, so studies stay
 * `userId = owner` and everyone in the workspace works on them. Invites are memberships with status "invited".
 */
export const ROLES = ['admin', 'researcher', 'viewer'] as const;
export type Role = 'owner' | (typeof ROLES)[number];

const membershipSchema = new Schema(
  {
    workspaceId: { type: Types.ObjectId, ref: 'Researcher', required: true, index: true },
    researcherId: { type: Types.ObjectId, ref: 'Researcher', index: true }, // set once accepted
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ROLES, required: true },
    status: { type: String, enum: ['invited', 'active', 'removed'], default: 'invited', index: true },
    tokenHash: { type: String, select: false },
    expiresAt: Date,
    invitedBy: { type: Types.ObjectId, ref: 'Researcher' },
    acceptedAt: Date,
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_d: unknown, ret: Record<string, any>) => {
        ret.membershipId = String(ret._id);
        for (const k of ['_id', 'workspaceId', 'researcherId', 'invitedBy']) if (ret[k]) ret[k] = String(ret[k]);
        delete ret.__v;
        delete ret.tokenHash;
        return ret;
      },
    },
  }
);
membershipSchema.index({ workspaceId: 1, email: 1 });

export const MembershipModel = model('Membership', membershipSchema);
