const config = require("stockpiler")(),
    moment = require("moment"),
    _ = require("lodash"),
    async = require("async"),
    EventEmitter = require("events").EventEmitter;

const Prediction = require("./Prediction"),
    YouTube = require("./YouTube"),
    Reddit = require("./Reddit"),
    Digg = require("./Digg");

const Video = require("./models/Video");

class Crawler {
    constructor(redis) {
        this.redis = redis;
        this.prediction = new Prediction();
        this.youTube = new YouTube();
        this.digg = new Digg();
        this.reddit = new Reddit();
    }

    _addToRedisBlackList(videoId, next) {
        this.redis.sadd("filteredVideoIds", videoId, next);
    }

    _saveVideo(source, videoDetails, channelDetails, next) {
        Video.create({
            videoId: videoDetails.id,
            channelId: videoDetails.snippet.channelId,
            categoryId: videoDetails.snippet.categoryId,
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
                            this.youTube.videoStatistics([item.id.videoId], cb, true);
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
                            this._saveVideo("youTube", results.videoStatistics.items[0], results.channelStatistics.items[0], callback);
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

    searchDigg(next) {
        console.log("Searching Digg...");

        this.digg.scrapeDigg((err, videoIds) => {
            if(!!err) return next(err);
            this._processVideoIds("digg", videoIds, next);
        });
    }

    searchReddit(next) {
        console.log("Searching Reddit...");

        this.reddit.scrapeSubreddits(undefined, (err, videoIds) => {
            if(!!err) return next(err);
            this._processVideoIds("reddit", videoIds, next);
        });
    }

    searchYouTube(next) {
        console.log("Searching YouTube...");

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

    // Update old videos with final view counts
    archiveOldVideos(next) {
        console.log("Archiving old videos...");

        Video.find({
            "active": false,
            "archived": false,
            "$where": `new Date().getTime() >= new Date(this.createdAt.getTime() + (${config.minArchiveAgeSecs} * 1000))`
        }, { _id: 1, videoId: 1, createdAt: 1 }, { lean: true }, (err, videos) => {
            if(!!err || !videos.length) return next(err);

            console.log(`Archiving ${videos.length} videos...`);

            const c = async.cargo((videos, callback) => {
                this.youTube.videoStatistics([videos.map(video => video.videoId)], (err, videoStatistics) => {
                    if(!!err) {
                        console.error(err);
                        return callback(err);
                    }

                    const updatedVideos = videos.map(video => {
                        const videoStatisticsItem = _.find(videoStatistics.items, "id", video.videoId);

                        let updateObj = {
                            updatedAt: new Date()
                        };

                        if(!videoStatisticsItem) {
                            // Video was likely made private
                            updateObj.wasRemoved = true;
                        } else {
                            updateObj.statistics = {
                                viewCount: videoStatisticsItem.statistics.viewCount,
                                likeCount: videoStatisticsItem.statistics.likeCount,
                                dislikeCount: videoStatisticsItem.statistics.dislikeCount,
                                favoriteCount: videoStatisticsItem.statistics.favoriteCount,
                                commentCount: videoStatisticsItem.statistics.commentCount
                            };

                            // Add new value to historicalStatistics if stats have changed
                            if(_.reduce(video.statistics, (isDiff, value, key) => {
                                return isDiff || parseInt(updateObj.statistics[key]) !== parseInt(value);
                            }, false)) {
                                updateObj["$push"] = {
                                    historicalStatistics: {
                                        timestamp: Date.now(),
                                        viewCount: videoStatisticsItem.statistics.viewCount,
                                        likeCount: videoStatisticsItem.statistics.likeCount,
                                        dislikeCount: videoStatisticsItem.statistics.dislikeCount,
                                        favoriteCount: videoStatisticsItem.statistics.favoriteCount,
                                        commentCount: videoStatisticsItem.statistics.commentCount
                                    }
                                };
                            }
                        }

                        // If likes are higher than views, assume view count is not yet accurate
                        if(updateObj.wasRemoved || moment(video.createdAt).add(config.maxArchiveAgeSecs).isBefore(new Date()) || (updateObj.statistics.viewCount > updateObj.statistics.likeCount)) {
                            updateObj.archived = true;
                        }

                        return {
                            _id: video._id,
                            updateObj: updateObj
                        };
                    });

                    // Save updated videos to the DB
                    async.eachLimit(updatedVideos, config.youTube.concurrency, (updatedVideo, callback) => {
                        Video.update({ _id: updatedVideo._id }, updatedVideo.updateObj, callback);
                    }, callback);
                });
            }, 50 /* Max results allowed by YouTube API */);

            let interval = setInterval(() => {
                console.log(`${c.length()} videos remaining to archive`);
            }, 5000);

            c.drain = () => {
                clearInterval(interval);
                next();
            };

            c.push(videos);
        });
    }

    updateTopPredictedViews(next) {
        console.log("Updating predicted views...");

        Video.find({
            "historicalStatistics.2": {
                "$exists": true
            },
            "statistics.likeCount": {
                "$gte": 25
            },
            active: true,
            title: {
                "$not": /movie|minecraft|hardline|hearthstone|cs:go|dota|(league of legends)|gta|(my little pony)|download|(m\.o\.v\.i\.e)|episode|keygen|cheat|wwe|(game of thrones)/ig
            }
        }, {
            _id: 1,
            videoId: 1,
            title: 1,
            description: 1,
            categoryId: 1,
            predictedViewCount: 1,
            channelSubscriberCount: 1
        }, { lean: true }, (err, videos) => {
            if(!!err) return next(err);
            if(!videos.length) return next();

            async.eachLimit(_.reject(videos, video => _.has(video, "predictedViewCount")), config.prediction.concurrency, (video, callback) => {
                this.prediction.predictViewCount(video, (err, result) => {
                    if(err) return callback(err);
                    Video.update({ _id: video._id }, { predictedViewCount: Math.round(parseInt(result.outputValue)) }, callback);
                });
            }, next);
        });
    }

    updateAll301(next) {
        console.log("Updating...");

        Video.find({ "statistics.viewCount": 301, "active": true }, {
            _id: 1,
            videoId: 1,
            statistics: 1
        }, { lean: true }, (err, videos) => {
            if(!!err) return next(err);
            if(!videos.length) return next();

            console.log(`Updating ${videos.length} videos...`);

            const c = async.cargo((videos, callback) => {
                this.youTube.videoStatistics([videos.map(video => video.videoId)], (err, videoStatistics) => {
                    if(!!err) {
                        console.error(err);
                        return callback(err);
                    }

                    const updatedVideos = videos.map(video => {
                        const videoStatisticsItem = _.find(videoStatistics.items, "id", video.videoId);

                        let updateObj = {
                            updatedAt: new Date()
                        };

                        if(!videoStatisticsItem) {
                            // Video was likely made private. Mark inactive.
                            updateObj.active = false;
                            updateObj.wasRemoved = true;
                        } else {
                            updateObj.statistics = {
                                viewCount: videoStatisticsItem.statistics.viewCount,
                                likeCount: videoStatisticsItem.statistics.likeCount,
                                dislikeCount: videoStatisticsItem.statistics.dislikeCount,
                                favoriteCount: videoStatisticsItem.statistics.favoriteCount,
                                commentCount: videoStatisticsItem.statistics.commentCount
                            };

                            // Add new value to historicalStatistics if stats have changed
                            if(_.reduce(video.statistics, (isDiff, value, key) => {
                                return isDiff || parseInt(updateObj.statistics[key]) !== parseInt(value);
                            }, false)) {
                                updateObj["$push"] = {
                                    historicalStatistics: {
                                        timestamp: Date.now(),
                                        viewCount: videoStatisticsItem.statistics.viewCount,
                                        likeCount: videoStatisticsItem.statistics.likeCount,
                                        dislikeCount: videoStatisticsItem.statistics.dislikeCount,
                                        favoriteCount: videoStatisticsItem.statistics.favoriteCount,
                                        commentCount: videoStatisticsItem.statistics.commentCount
                                    }
                                };
                            }
                        }

                        return {
                            _id: video._id,
                            updateObj: updateObj
                        };
                    });

                    // Save updated videos to the DB
                    async.eachLimit(updatedVideos, config.youTube.concurrency, (updatedVideo, callback) => {
                        Video.update({ _id: updatedVideo._id }, updatedVideo.updateObj, callback);
                    }, callback);
                });
            }, 50 /* Max results allowed by YouTube API */);

            let interval = setInterval(() => {
                console.log(`${c.length()} videos remaining to update`);
            }, 5000);

            c.drain = () => {
                clearInterval(interval);

                // Mark all videos with > 301 views as inactive
                Video.update({"statistics.viewCount": { "$gt": 301 } }, { active: false }, { multi: true }, next);
            };

            c.push(videos);
        });
    }
};

module.exports = Crawler;
