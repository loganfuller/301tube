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

videoSchema.statics.regenerateRankings = function(next) {
    return this.mapReduce({
        map: function() {
            let timeDiffSecs = (this.publishedAt / 1000) - 1427851426,
                voteScore = this.statistics.likeCount - this.statistics.dislikeCount,
                totalScore = voteScore + (1.25 * this.statistics.favoriteCount) + (1 * this.statistics.commentCount);

            let scalingFactor;
            if(this.channelSubscriberCount > 200000) {
                scalingFactor = 0.75;
            } else {
                scalingFactor = 1 - (this.channelSubscriberCount * 0.25) / 200000;
            }

            if(this.source === "reddit") {
                scalingFactor += 0.1;
            }

            let y;
            if(voteScore < 0) {
                y = -1;
            } if(voteScore > 0 || (voteScore === 0 && totalScore > 0)) {
                y = 1;
            } else {
                y = 0;
            }

            let rank = scalingFactor * (Math.log(Math.max(Math.abs(totalScore),1))/Math.LN10) + (y * timeDiffSecs) / 45000;
            // var rank = (y * Math.abs(totalScore * scalingFactor)) / (Math.pow(timeDiffHours + 2, 1.5));

            emit(this._id, {
                videoId: this.videoId,
                url: "https://www.youtube.com/watch?v=" + this.videoId,
                title: this.title,
                source: this.source,
                description: this.description,
                channelSubscriberCount: this.channelSubscriberCount,
                publishedAt: this.publishedAt,
                statistics: this.statistics,
                scalingFactor: scalingFactor,
                rank: rank
            });
        },
        reduce: function(_id, obj) {
            return obj;
        },
        query: {
            "statistics.viewCount": 301,
            active: true,
            title: {
                "$not": /movie|minecraft|trailer|(my little pony)|download|(m\.o\.v\.i\.e)|episode|hack|keygen|cheat|wwe/ig
            }
        },
        jsMode: true,
        out: {
            replace: "scored_videos"
        }
    }, next);
};

module.exports = mongoose.model("Video", videoSchema);
