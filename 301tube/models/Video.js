const mongoose = require("mongoose"),
    Schema = mongoose.Schema;

const videoSchema = new Schema({
    active: { type: Boolean, default: true },
    videoId: { type: String, index: { unique: true } },
    channelId: String,
    channelSubscriberCount: Number,
    channelTitle: String,
    publishedAt: Date,
    title: String,
    description: String,
    source: { type: String, enum: ["youTube", "reddit"] },
    thumbnails: {
        default: String,
        medium: String,
        high: String
    },
    statistics: {
        viewCount: Number,
        likeCount: Number,
        dislikeCount: Number,
        favoriteCount: Number,
        commentCount: Number
    },
    historicalStatistics: [{
        timestamp: { type: Date, default: Date.now },
        viewCount: Number,
        likeCount: Number,
        dislikeCount: Number,
        favoriteCount: Number,
        commentCount: Number
    }]
}, {
    strict: true,
    safe: true
});

module.exports = mongoose.model("Video", videoSchema);
