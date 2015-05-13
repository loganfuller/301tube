const config = require("stockpiler")(),
    moment = require("moment"),
    _ = require("lodash"),
    async = require("async"),
    EventEmitter = require("events").EventEmitter;

const YouTube = require("./YouTube"),
    Reddit = require("./Reddit");

const Video = require("./models/Video");

class Crawler {
    constructor(redis) {
        this.redis = redis;
        this.youTube = new YouTube();
        this.reddit = new Reddit();
    }

    _addToRedisBlackList(videoId, next) {
        this.redis.sadd("filteredVideoIds", videoId, next);
    }

    _saveVideo(source, videoDetails, channelDetails, next) {
        Video.create({
            videoId: videoDetails.id,
            channelId: videoDetails.snippet.channelId,
            channelSubscriberCount: channelDetails.statistics.subscriberCount,
            channelTitle: videoDetails.snippet.channelTitle,
            publishedAt: videoDetails.snippet.publishedAt,
            title: videoDetails.snippet.title,
            description: videoDetails.snippet.description,
            source: source,
            thumbnails: {
                default: videoDetails.snippet.thumbnails.default.url,
                medium: videoDetails.snippet.thumbnails.medium.url,
                high: videoDetails.snippet.thumbnails.high.url
            },
            statistics: {
                viewCount: videoDetails.statistics.viewCount,
                likeCount: videoDetails.statistics.likeCount,
                dislikeCount: videoDetails.statistics.dislikeCount,
                favoriteCount: videoDetails.statistics.favoriteCount,
                commentCount: videoDetails.statistics.commentCount
            },
            historicalStatistics: [{
                timestamp: Date.now(),
                viewCount: videoDetails.statistics.viewCount,
                likeCount: videoDetails.statistics.likeCount,
                dislikeCount: videoDetails.statistics.dislikeCount,
                favoriteCount: videoDetails.statistics.favoriteCount,
                commentCount: videoDetails.statistics.commentCount
            }]
        }, next);
    }

    _processVideoIds(source, videoIds, next) {
        const q = async.queue((videoId, callback) => {
            // Check if video is in Redis blacklist
            this.redis.sismember("filteredVideoIds", videoId, (err, found) => {
                if(!!err) {
                    console.error(err);
                    return callback(err);
                } else if(found === 1) {
                    return callback();
                }

                // Check if video already exists in the DB
                Video.findOne({ videoId: videoId }, "videoId", { lean: true }, (err, videoRecord) => {
                    if(!!err) {
                        console.error(err);
                        return callback(err);
                    } else if(videoRecord) {
                        return callback();
                    }

                    // If first-level filters passed, fetch info
                    async.waterfall([
                        cb => this.youTube.videoStatistics([videoId], cb, true),
                        (videoStatistics, cb) => videoStatistics.items.length ? this.youTube.channelStatistics([videoStatistics.items[0].snippet.channelId], (err, channelStatistics) => cb(err, videoStatistics, channelStatistics)) : cb(err, videoStatistics, null)
                    ], (err, videoStatistics, channelStatistics) => {
                        if(!!err) {
                            callback(err);
                        } else if(!videoStatistics.items.length || !channelStatistics.items.length || videoStatistics.items[0].statistics.viewCount > 301) {
                            this._addToRedisBlackList(videoId, callback);
                        } else if(videoStatistics.items[0].statistics.viewCount === "301") {
                            // Save video to Mongo
                            this._saveVideo(source, videoStatistics.items[0], channelStatistics.items[0], callback);
                        } else {
                            callback();
                        }
                    });
                });
            });
        }, config.youTube.concurrency);
        q.drain = next;
        q.push(videoIds);
    }

    _processYouTubeSearchResultsPage(page, next) {
        const q = async.queue((item, callback) => {
            // Check if video is in Redis blacklist
            this.redis.sismember("filteredVideoIds", item.id.videoId, (err, found) => {
                if(!!err) {
                    console.error(err);
                    return callback(err);
                } else if(found === 1) {
                    return callback();
                } else if(item.snippet.liveBroadcastContent !== "none") {
                    return this._addToRedisBlackList(item.id.videoId, callback);
                }

                // Check if video already exists in the DB
                Video.findOne({ videoId: item.id.videoId }, "videoId", { lean: true }, (err, videoRecord) => {
                    if(!!err) {
                        console.error(err);
                        return callback(err);
                    } else if(videoRecord) {
                        return callback();
                    }

                    // If first-level filters passed, fetch additional info
                    async.parallel({
                        videoStatistics: cb => {
                            this.youTube.videoStatistics([item.id.videoId], cb);
                        },
                        channelStatistics: cb => {
                            this.youTube.channelStatistics([item.snippet.channelId], cb);
                        }
                    }, (err, results) => {
                        if(!!err) {
                            console.error(err);
                            return callback(err);
                        } else if(!results.channelStatistics.items.length || !results.videoStatistics.items.length || results.videoStatistics.items[0].statistics.viewCount > 301) {
                            return this._addToRedisBlackList(item.id.videoId, callback);
                        } else if(results.videoStatistics.items[0].statistics.viewCount === "301") {
                            // Save video to Mongo
                            this._saveVideo("youTube", _.merge(item, results.videoStatistics.items[0]), results.channelStatistics.items[0], callback);
                        } else {
                            callback();
                        }
                    });
                });
            });
        }, config.youTube.concurrency);
        q.drain = next;
        q.push(page.items);
    }

    searchReddit(next) {
        // console.log("Searching Reddit...");

        this.reddit.scrapeSubreddits(undefined, (err, videoIds) => {
            if(!!err) return next(err);
            this._processVideoIds("reddit", videoIds, next);
        });
    }

    searchYouTube(next) {
        // console.log("Searching YouTube...");

        let searchStartTime = moment().subtract(config.youTube.latestVideoLookbackMins, "minutes"),
            searchEndTime = new Date(),
            prevResults = {},
            repeatedPages = 0,
            nextPageToken = null,
            pagesLoaded = 0;

        async.whilst(
            () => {
                return pagesLoaded < config.youTube.maxPages && (nextPageToken || pagesLoaded === 0);
            },
            callback => {
                this.youTube.listVideos(searchStartTime, searchEndTime, (err, results) => {
                    if(!!err) return callback(err);

                    // See if results are identical for whatever reason (come on Google...)
                    if(prevResults.items && !_.difference(_.pluck(prevResults.items, "id.videoId"), _.pluck(results.items, "id.videoId")).length) {
                        // console.log("page repeated")

                        repeatedPages++;
                        nextPageToken = results.nextPageToken || null;

                        return callback();
                    }

                    prevResults = results;
                    nextPageToken = results.nextPageToken || null;
                    pagesLoaded++;

                    // console.log(`Page ${pagesLoaded}`)

                    this._processYouTubeSearchResultsPage(results, callback);
                }, nextPageToken);
            },
            next
        );
    }

    updateAll301(next) {
        // console.log("Updating...");

        Video.find({ "statistics.viewCount": 301, "active": true }, null, { lean: true }, (err, videos) => {
            if(!!err) return next(err);
            if(!videos.length) return next();

            const q = async.queue((video, callback) => {
                // TODO: batch this
                this.youTube.videoStatistics([video.videoId], (err, videoStatistics) => {
                    if(!!err) {
                        console.error(err);
                        return callback(err);
                    }

                    let updateObj = {};
                    if(!videoStatistics.items.length) {
                        // Video was likely made private. Mark inactive.
                        updateObj.active = false;
                    } else {
                        updateObj.statistics = {
                            viewCount: videoStatistics.items[0].statistics.viewCount,
                            likeCount: videoStatistics.items[0].statistics.likeCount,
                            dislikeCount: videoStatistics.items[0].statistics.dislikeCount,
                            favoriteCount: videoStatistics.items[0].statistics.favoriteCount,
                            commentCount: videoStatistics.items[0].statistics.commentCount
                        };

                        // Add new value to historicalStatistics if stats have changed
                        if(_.reduce(video.statistics, (isDiff, value, key) => {
                            return isDiff || parseInt(updateObj.statistics[key]) !== parseInt(value);
                        }, false)) {
                            updateObj["$push"] = {
                                historicalStatistics: {
                                    timestamp: Date.now(),
                                    viewCount: videoStatistics.items[0].statistics.viewCount,
                                    likeCount: videoStatistics.items[0].statistics.likeCount,
                                    dislikeCount: videoStatistics.items[0].statistics.dislikeCount,
                                    favoriteCount: videoStatistics.items[0].statistics.favoriteCount,
                                    commentCount: videoStatistics.items[0].statistics.commentCount
                                }
                            };
                        }
                    }

                    Video.update({ videoId: video.videoId }, updateObj, err => {
                        if(!!err) {
                            console.error(err);
                            return callback(err);
                        }

                        // Mark all videos with > 301 views as inactive
                        Video.update({"statistics.viewCount": { "$ne": 301 } }, { active: false }, { multi: true }, callback);
                    });
                });
            }, config.youTube.concurrency);
            q.drain = next;
            q.push(videos);
        });
    }
};

module.exports = Crawler;