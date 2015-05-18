const mongoose = require("mongoose"),
    Schema = mongoose.Schema,
    fs = require("fs"),
    path = require("path"),
    regression = require("regression"),
    spearson = require("spearson");

let _rankedModel;

const videoSchema = new Schema({
    active: { type: Boolean, default: true },
    videoId: { type: String, index: { unique: true } },
    channelId: String,
    categoryId: String,
    channelSubscriberCount: Number,
    channelTitle: String,
    publishedAt: Date,
    title: String,
    description: String,
    source: { type: String, enum: ["youTube", "reddit", "digg"] },
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

videoSchema.statics.getRankedModel = function(next) {
    if(_rankedModel) {
        next(null, _rankedModel);
    } else {
        this.regenerateRankings(next);
    }
};

let mapFuncString = `(function() {
    var timeDiffSecs = (this.publishedAt / 1000) - 1427851426,
        voteScore = this.statistics.likeCount - this.statistics.dislikeCount;

    var scalingFactor;
    if(this.channelSubscriberCount > 300000) {
        scalingFactor = 0.6;
    } else {
        scalingFactor = 1 - (this.channelSubscriberCount * 0.4) / 300000;
    }

    if(this.source !== "youTube") {
        scalingFactor += 0.05;
    }

    var y = 0;
    if(voteScore < 0) {
        y = -1;
    } else if(voteScore > 0) {
        y = 1;
    }

    // Exponential regression analysis
    var window = {};
    '__SPEARSON__'
    '__REGRESSION__'

    var initialTimestamp = this.historicalStatistics[0].timestamp / 1000,
        historicalScoreData = this.historicalStatistics.map(function(dataPoint) { return [(dataPoint.timestamp/1000) - initialTimestamp, dataPoint.likeCount - dataPoint.dislikeCount]; });

    var rLin = this.spearson.correlation.pearson(
        historicalScoreData.map(function(point) { return point[1]; }),
        window.regression("linear", historicalScoreData).points.map(function(point) { return point[1]; })
    );
    var rExp = this.spearson.correlation.pearson(
        historicalScoreData.map(function(point) { return point[1]; }),
        window.regression("exponential", historicalScoreData).points.map(function(point) { return point[1]; })
    );
    var rDiff = (rExp > rLin && rExp >= 0.8) ? rExp - rLin : 0;

    scalingFactor += (rDiff * 5);

    var score = scalingFactor * (Math.log(Math.max(Math.abs(voteScore),1))/Math.LN10) + (y * timeDiffSecs) / 45000;
    // var score = (y * Math.abs(totalScore * scalingFactor)) / (Math.pow(timeDiffHours + 2, 1.5));

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
        score: score,
        rExp: rExp,
        rLin: rLin,
        rDiff: rDiff
    });
})`
    .replace("'__SPEARSON__'", fs.readFileSync(require.resolve("spearson"), { encoding: "utf8" }))
    .replace("'__REGRESSION__'", fs.readFileSync(path.resolve(require.resolve("regression"), "../build/regression.min.js"), { encoding: "utf8" }));

videoSchema.statics.regenerateRankings = function(next) {
    console.log("Regenerating rankings...");

    return this.mapReduce({
        map: eval(mapFuncString),
        reduce: function(_id, obj) {
            return obj;
        },
        query: {
            "historicalStatistics.4": {
                "$exists": true
            },
            "statistics.likeCount": {
                "$gte": 25
            },
            active: true,
            title: {
                "$not": /movie|minecraft|hardline|hearthstone|gta|(my little pony)|download|(m\.o\.v\.i\.e)|episode|keygen|cheat|wwe|(game of thrones)/ig
            }
        },
        jsMode: true,
        out: {
            replace: "scored_videos"
        }
    }, (err, model) => {
        _rankedModel = err ? null : model;
        next(err, model);
    });
};

module.exports = mongoose.model("Video", videoSchema);
