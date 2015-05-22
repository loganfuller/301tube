const config = require("stockpiler")(),
    _ = require("lodash"),
    google = require("googleapis");

const _sanitizeString = str => str.replace(/\r?\n|\r/g).replace(/\b((?:[a-z][\w-]+:(?:\/{1,3}|[a-z0-9%])|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]+|\(([^\s()<>]+|(\([^\s()<>]+\)))*\))+(?:\(([^\s()<>]+|(\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’]))/g, "URLREMOVED").replace(/[!";:,&.\/?\\-\\(\\)\[\]]/g, "").replace(/ {2,}/g, " ");

class Prediction {
    constructor() {
        this.isAuthorized = false;
        this.authTokens = null;

        this.authClient = new google.auth.JWT(
            config.google.clientEmail,
            null,
            config.google.privateKey,
            "https://www.googleapis.com/auth/prediction"
        );

        this.prediction = google.prediction({
            version: "v1.6"
        });
    }

    _lazyAuth(next) {
        if(this.isAuthorized) return next();
        this.authClient.authorize((err, tokens) => {
            if(!err) {
                this.authTokens = tokens;
                this.isAuthorized = true;
            }
            next(err);
        });
    }

    predictViewCount(video, next) {
        this._lazyAuth(err => {
            if(err) return next(err);

            this.prediction.trainedmodels.predict({
                auth: this.authClient,
                id: config.prediction.viewCountsModel,
                project: config.prediction.projectId.toString(),
                resource: {
                    input: {
                        csvInstance: [
                            video.categoryId,
                            _sanitizeString(video.title),
                            _sanitizeString(video.description),
                            video.channelSubscriberCount
                        ]
                    }
                }
            }, (err, results) => next(err, results));
        });
    }
};

module.exports = Prediction;
