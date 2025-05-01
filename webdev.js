//DISABLES MONITORING. DO NOT USE IN PRODUCTION
require('dotenv/config');
const https = require('https');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { db } = require('./db.js');
const plist = require('plist');
const express = require('express');
const bodyParser = require('body-parser');
var helmet = require('helmet')


// web app init
const app = express();
const server = https.createServer(app);
app.use(bodyParser.json());
app.use(express.static("public"));
app.use(helmet());


const { TextWriter, Uint8ArrayReader, ZipReader } = require('@zip.js/zip.js');
const { upload } = require('./upload.js');

app.get("/api/index", (req, res) => {
    const availableBuilds = db.prepare(`select count(chromium_version) c from chromium where is_uploaded > 0`).get()
    const availableBuildIndex = db.prepare(`SELECT chromium_version, count(*) as available_build_count FROM chromium where is_uploaded = '1' GROUP BY chromium_version ORDER by build DESC`).all()
    //const Index = db.prepare(`SELECT build, build_date, created_date, chromium_version, filename, filesize, sha1 FROM chromium EXCLUDE where is_uploaded = '1' ORDER by build DESC`).all()

    res.json({
        availableBuilds: availableBuilds.c,
        availableBuildIndex: availableBuildIndex,
        //buildIndex: Index
    });
});
app.get("/api/index/:id", (req, res) => {
    const availableBuilds = db.prepare(`select count(chromium_version) c from chromium where chromium_version = ?`).get([req.params.id])
    const Index = db.prepare(`SELECT build FROM chromium EXCLUDE where chromium_version = ?  ORDER by build DESC`).all([req.params.id])
    res.json({
        availableBuilds: availableBuilds.c ?? 0,
        buildIndex: Index ?? 0
    });
});

app.get("/api/index/:id/:build", (req, res) => {
    const Index = db.prepare(`SELECT * FROM chromium EXCLUDE where chromium_version = ? and build = ? ORDER by build DESC`).all([req.params.id, req.params.build])
    res.json(
        Index ?? 0
    );
});

console.log(`THIS IS A WEB TEST ENVIROMENT. DO NOT USE IN PRODUCTION`);

const PORT = process.env.PORT || 2120;
server.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});