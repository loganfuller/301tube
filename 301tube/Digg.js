const config = require("stockpiler")(),
    _ = require("lodash"),
    xray = require("x-ray"),
    async = require("async");

class Digg {
    scrapeDigg(next) {
        let videoIds = [];
        xray("http://digg.com/video")
            .select(["article.story-video[data-contenturl]"])
            .throws(false)
            .run((err, articleUrls) => {
                if(!!err) {
                    console.error(err);
                    return callback(err);
                } else if(!articleUrls.length) {
                    return callback(null);
                }

                const q = async.queue((articleUrl, callback) => {
                    xray(articleUrl)
                        .select("iframe.embedly-embed[src]")
                        .throws(false)
                        .run((err, url) => {
                            if(!!err) {
                                console.error(err);
                                return callback(err);
                            } else if(!url) {
                                return callback();
                            }

                            if(url.search(/youtube\.com\/embed\/([\w-]*?)(?:\?|$)/i) !== -1) {
                                videoIds.push(url.match(/youtube\.com\/embed\/([\w-]*?)(?:\?|$)/i)[1]);
                            }

                            callback();
                        });
                }, config.digg.concurrency);

                q.drain = () => next(null, _.unique(videoIds));
                q.push(articleUrls);
            });
    }
};

module.exports = Digg;
