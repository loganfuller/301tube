const config = require("stockpiler")(),
    _ = require("lodash"),
    xray = require("x-ray"),
    async = require("async");

class Reddit {
    scrapeSubreddits(subreddits=["videos", "funny", "aww", "AskReddit", "todayilearned", "worldnews", "IAmA", "news", "technology", "bestof", "all"], next) {
        let videoIds = [];

        const q = async.queue((subreddit, callback) => {
            xray(`http://www.reddit.com/r/${subreddit}/new/`)
                .select(["a.title[href]"])
                .throws(false)
                .paginate(".nextprev a:last-child[href]")
                .limit(config.reddit.maxPages)
                .run((err, links) => {
                    if(!!err) {
                        console.error(err);
                        return callback(err);
                    }

                    videoIds.push(..._.map(
                        _.filter(links, link => link.search(/youtube\.com(?:.*)v=([\w-]*?)(?:&|\/|$)/i) !== -1),
                        link => link.match(/youtube\.com(?:.*)v=([\w-]*?)(?:&|\/|$)/i)[1]
                    ));

                    callback();
                });
        }, config.reddit.concurrency);

        q.drain = () => next(null, _.unique(videoIds));
        q.push(subreddits);
    }
};

module.exports = Reddit;
