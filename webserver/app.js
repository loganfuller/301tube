const config = require("stockpiler")(),
    _ = require("lodash"),
    url = require("url"),
    express = require("express"),
    exphbs = require("express-handlebars"),
    compression = require("compression");

const app = express();

const Video = require("../301tube/models/Video");

// Template engine
app.engine("handlebars", exphbs());
app.set("view engine", "handlebars");
app.set("views", "webserver/views/");
app.set("trust proxy", true);
app.set("etag", config.webserver.etag);

// GZip / Deflate compression
if(config.webserver.compression.enabled) {
    app.use(compression({
        level: config.webserver.compression.level,
        threshold: config.webserver.compression.threshold
    }));
}

// Static asset serving
app.use(express.static("public", config.webserver.static));

// Removes x-powered-by header if true (makes automated intrusion attempts harder)
app.set("x-powered-by", config.webserver.xPoweredBy);

app.get("*", function (req, res) {
    Video.getRankedModel((err, rankedModel) => {
        if(err) {
            console.error(err);
            res.sendStatus(500);
        } else {
            rankedModel
                .find()
                .limit(25)
                .sort("-value.rank")
                .exec((err, videos) => {
                    if(err) {
                        console.error(err);
                        res.sendStatus(500);
                    } else {
                        res.render("index", {
                            production: process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging",
                            useCdn: config.client.useCdn,
                            clientConfig: JSON.stringify(config.client),
                            videos: videos.map(function(video) {
                                return {
                                    videoId: video.value.videoId,
                                    title: video.value.title
                                };
                            })
                        });
                    }
                });
        }
    });
});

module.exports = {
    app: app,
    startServer: next => {
        next = next || function() {};

        // Create the HTTP server
        const server = app.listen(config.webserver.port, config.webserver.host, () => {
            const { address: address, port: port } = server.address();
            console.log(`Express server listening on ${address}:${port}`);
            next();
        });
    }
};
