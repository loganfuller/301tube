const config = require("stockpiler")(),
    http = require("http"),
    _ = require("lodash"),
    Video = require("./models/Video"),
    YouTube = require("./YouTube"),
    Crawler = require("./Crawler"),
    mongoose = require("mongoose"),
    Redis = require("redis"),
    parseRedisUrl = require("parse-redis-url")(Redis);

// Initialize DB
mongoose.connect(config.db.uri);
const db = mongoose.connection;
db.on("error", err => console.error(`mongo error: ${err}`));

// Initialize Redis
let redis;
if(config.redis.uri) {
    const redisOpts = parseRedisUrl.parse(config.redis.uri);
    redis = Redis.createClient(redisOpts.port, redisOpts.host, _.extend(config.redis.options, {auth_pass: redisOpts.password}));
} else {
    redis = Redis.createClient(config.redis.port, config.redis.host, config.redis.options);
}
redis.on("error", err => console.error(`redis error: ${err}`));

// Initialize modules
const crawler = new Crawler(redis);

let youTubeSearchTimeout;
const scheduleYouTubeSearch = function() {
    youTubeSearchTimeout = setTimeout(() => {
        youTubeSearchTimeout = null;
        crawler.searchYouTube(err => {
            if(!!err) console.error(`search error: ${err}`);
            scheduleYouTubeSearch();
        });
    }, config.youTube.searchCooldownSecs * 1000);
};

let diggSearchTimeout;
const scheduleDiggSearch = function() {
    diggSearchTimeout = setTimeout(() => {
        diggSearchTimeout = null;
        crawler.searchDigg(err => {
            if(!!err) console.error(`search error: ${err}`);
            scheduleDiggSearch();
        });
    }, config.digg.searchCooldownSecs * 1000);
};

let redditSearchTimeout;
const scheduleRedditSearch = function() {
    redditSearchTimeout = setTimeout(() => {
        redditSearchTimeout = null;
        crawler.searchReddit(err => {
            if(!!err) console.error(`search error: ${err}`);
            scheduleRedditSearch();
        });
    }, config.reddit.searchCooldownSecs * 1000);
};

let updateTimeout;
const scheduleUpdate = function() {
    updateTimeout = setTimeout(() => {
        updateTimeout = null;
        crawler.updateAll301(err => {
            if(!!err) console.error(`update error: ${err}`);

            if(config.prediction.enabled) {
                crawler.updateTopPredictedViews(err => {
                    if(!!err) console.error(`view prediction update error: ${err}`);

                    Video.regenerateRankings((err, model) => {
                        if(!!err) console.error(`ranking update error: ${err}`);

                        console.log("Update complete.");

                        scheduleUpdate();
                    });
                });
            } else {
                Video.regenerateRankings((err, model) => {
                    if(!!err) console.error(`ranking update error: ${err}`);

                    console.log("Update complete.");

                    scheduleUpdate();
                });
            }
        });
    }, config.updateCooldownSecs * 1000);
};

let archiveTimeout;
const scheduleArchive = function() {
    archiveTimeout = setTimeout(() => {
        archiveTimeout = null;
        crawler.archiveOldVideos(err => {
            if(!!err) console.error(`archive error: ${err}`);
            scheduleArchive();
        });
    }, config.archiveCooldownSecs * 1000);
};

module.exports = {
    start: () => {
        // Perform initial YouTube search
        crawler.searchYouTube(err => {
            if(!!err) console.error(`search error: ${err}`);
            scheduleYouTubeSearch();
        });

        // Perform initial Digg search
        crawler.searchDigg(err => {
            if(!!err) console.error(`search error: ${err}`);
            scheduleDiggSearch();
        });

        // Perform initial Reddit search
        crawler.searchReddit(err => {
            if(!!err) console.error(`search error: ${err}`);
            scheduleRedditSearch();
        });

        // Perform initial update
        crawler.updateAll301(err => {
            if(!!err) console.error(`update error: ${err}`);

            if(config.prediction.enabled) {
                crawler.updateTopPredictedViews(err => {
                    if(!!err) console.error(`view prediction update error: ${err}`);

                    Video.regenerateRankings((err, model) => {
                        if(!!err) console.error(`ranking update error: ${err}`);

                        console.log("Update complete.");

                        scheduleUpdate();
                    });
                });
            } else {
                Video.regenerateRankings((err, model) => {
                    if(!!err) console.error(`ranking update error: ${err}`);

                    console.log("Update complete.");

                    scheduleUpdate();
                });
            }
        });

        // Perform initial archive
        crawler.archiveOldVideos(err => {
            if(!!err) console.error(`archive error: ${err}`);
            scheduleArchive();
        });
    },
    stop: () => {
        clearTimeout(youTubeSearchTimeout);
        clearTimeout(diggSearchTimeout);
        clearTimeout(redditSearchTimeout);
        clearTimeout(updateTimeout);
        clearTimeout(archiveTimeout);
    }
};
