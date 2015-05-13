"use strict";

// Application Monitoring
if(process.env.NEW_RELIC_LICENSE_KEY) {
    require("newrelic");
}

// ES6 Transpiler
if(!/babel-node/ig.test(process.env._)) {
    require("babel/register")({
        ignore: false,
        only: /^.*\/301tube\/lib\//
    });
}

// Configuration Settings
var config = require("stockpiler")({
    envMap: {
        "REDISCLOUD_URL": "REDIS__URI",
        "REDIS_URL": "REDIS__URI",
        "MONGOLAB_URI": "DB__URI"
    }
});

require("../lib").start();
