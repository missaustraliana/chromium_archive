require('dotenv/config');
const https = require('https');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { get } = require('http');
const crypto = require('crypto');
const { db } = require('./db.js');
const plist = require('plist');
const { TextWriter, Uint8ArrayReader, ZipReader } = require('@zip.js/zip.js');
const { upload } = require('./upload.js');

function getTimeAgo(timestamp) {
    const now = new Date();
    const lastModifiedDate = new Date(timestamp);
    const diffMs = now - lastModifiedDate;

    const diffSeconds = Math.floor(diffMs / 1000);

    if (diffSeconds < 60) {
        return `${diffSeconds} second${diffSeconds !== 1 ? 's' : ''} ago`;
    }


    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) {
        return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    }


    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
        return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    }


    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
}


const url = 'https://download-chromium.appspot.com/rev/Mac_Arm?type=snapshots';
const dataFilePath = path.join(__dirname, 'last_content.txt');
const checkInterval = 5000;
function checkURL() {
    const options = {
        family: 4,
        headers: {
            'User-Agent': 'chromium-archive'
        }
    };

    https.get(url, options, (res) => {

        let data = '';

        res.on('data', (chunk) => {
            data += chunk;
        });

        res.on('end', () => {
            try {
                // Parse the content as JSON
                const jsonData = JSON.parse(data);
                const contentValue = jsonData.content;
                const lastModified = jsonData["last-modified"];

                // Check if we have a previous value stored
                let previousContent = null;
                let previousLastModified = null;
                try {
                    if (fs.existsSync(dataFilePath)) {
                        const previousData = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
                        previousContent = previousData.content;
                        previousLastModified = previousData["last-modified"];
                    }
                } catch (err) {
                    console.log('No previous content found, this is the first run.');
                }

                if (previousContent !== contentValue) {
                    console.log(`fresh off the google pot!🍝 last update was ${getTimeAgo(previousLastModified)}`);
                    console.log(`${previousContent} -> ${contentValue}`);

                    // URL of the file to download
                    const fileUrl = 'https://commondatastorage.googleapis.com/chromium-browser-snapshots/Mac_Arm/' + contentValue + '/chrome-mac.zip';
                    // The filename you want to save it as
                    const filename = contentValue + '.zip';

                    // Create a write stream
                    const fileStream = fs.createWriteStream(filename);

                    // Download the file
                    https.get(fileUrl, options, (response) => {
                        response.pipe(fileStream);

                        fileStream.on('finish', () => {
                            fileStream.close();
                            console.log(`Downloaded: ${filename}`);
                            doUpload(contentValue, lastModified);
                        });
                    });

                    // Save the new data
                    fs.writeFileSync(dataFilePath, JSON.stringify(jsonData, null, 2));

                    // You could add additional actions here like sending notifications
                }
            } catch (error) {
                console.error('Error processing response:', error.message);
            }
        });
    }).on('error', (err) => {
        console.error('Error making request:', err);
    });
}

// Initial check
checkURL();

// Set up recurring checks
setInterval(checkURL, checkInterval);
async function doUpload(commit, lastModified) {
    const zip = `${commit}.zip`;
    console.log(`Uploading: ${commit}.zip`);

    const fileSize = (await fsp.stat(zip)).size;

    // get the sha1 of the zip
    const file = await fsp.readFile(zip);
    const shasum = crypto.createHash('sha1');
    shasum.update(file);
    const sha1 = shasum.digest('hex');

    // get version from within the zip
    let chromiumVersion = '?';
    try {
        // Create a BlobReader for the zip file
        const zipData = await fsp.readFile(zip);
        const reader = new Uint8ArrayReader(new Uint8Array(zipData));
        const zipReader = new ZipReader(reader);

        // Get the entries in the zip file
        const entries = await zipReader.getEntries();

        // Find the Info.plist file
        const infoEntry = entries.find(entry => entry.filename == 'chrome-mac/Chromium.app/Contents/Info.plist');

        if (infoEntry) {
            // Extract just the Info.plist file
            // @ts-ignore
            const content = await infoEntry.getData(new TextWriter());

            // Parse the plist file
            const plistData = plist.parse(content);
            chromiumVersion = plistData['CFBundleShortVersionString'];
            console.log(`Chromium version: ${chromiumVersion}`);
        } else {
            console.log('Info.plist not found in the zip file');
        }

        // Close the zip reader
        await zipReader.close();
    } catch (error) {
        console.error('Error extracting Info.plist:', error);
    }

    db.prepare(`insert into chromium (build, build_date, chromium_version, filename, filesize, sha1) values (?, ?, ?, ?, ?, ?)`)
        .run([
            commit,
            new Date(lastModified).toISOString(),
            chromiumVersion,
            `${commit}.zip`,
            fileSize,
            sha1
        ]);

    await upload({
        filePath: zip,
        filename: zip,
        deleteAfterUpload: true
    });

    db.prepare(`update chromium set is_uploaded = 1 where build = ?`)
        .run(commit);
}

console.log(`Monitoring started. Checking every ${checkInterval / 1000} seconds.`);
