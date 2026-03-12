"use strict";
const mongoose = require("mongoose");
const waitlistSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
    },
    status: {
        type: String,
        enum: ["waiting", "invited", "joined"],
        default: "waiting",
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});
const WaitlistModel = mongoose.model("Waitlist", waitlistSchema);
module.exports = WaitlistModel;
