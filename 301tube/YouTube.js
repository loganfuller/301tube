const config = require("stockpiler")(),
    _ = require("lodash"),
    google = require("googleapis");

class YouTube {
    constructor() {
        this.youTube = google.youtube({
            version: "v3",
            auth: config.google.apiKey
        });
    }

    listVideos(startTime, endTime, next, pageToken=null) {
        this.youTube.search.list({
            part: "snippet",
            publishedAfter: startTime.toISOString(),
            publishedBefore: endTime.toISOString(),
            type: "video",
            pageToken: pageToken,
            maxResults: 50,
            order: "viewCount",
            relevanceLanguage: "EN",
            regionCode: "US"
        }, (err, results) => next(err, results));
    }

    videoStatistics(videoIds, next, includeSnippet=false) {
        this.youTube.videos.list({
            part: `id,statistics${includeSnippet ? ",snippet" : ""}`,
            id: videoIds.join(","),
            maxResults: videoIds.length
        }, (err, results) => next(err, results));
    }

    channelStatistics(channelIds, next) {
        this.youTube.channels.list({
            part: "statistics",
            id: channelIds.join(","),
            maxResults: channelIds.length
        }, (err, results) => next(err, results));
    }
};

module.exports = YouTube;
