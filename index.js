const https = require('https');
const fs = require('fs');
const path = require('path');
const { get } = require('http');



function getTimeAgo(timestamp) {
    const now = new Date();
    const lastModifiedDate = new Date(timestamp);
    const diffMs = now - lastModifiedDate;

    const diffSeconds = Math.floor(diffMs / 5000);

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
const checkInterval = 1000;
function checkURL() {

    https.get(url, {  headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36' }  }, (res) => {

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
                try {
                    if (fs.existsSync(dataFilePath)) {
                        const previousData = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
                        previousContent = previousData.content;
                    }
                } catch (err) {
                    console.log('No previous content found, this is the first run.');
                }

                if (previousContent !== contentValue) {
                    console.log('CHANGE DETECTED!');

                    // URL of the file to download
                    const fileUrl = 'https://commondatastorage.googleapis.com/chromium-browser-snapshots/Mac_Arm/' + contentValue + '/chrome-mac.zip';
                    // The filename you want to save it as
                    const filename = contentValue + '.zip';

                    // Create a write stream
                    const fileStream = fs.createWriteStream(filename);

                    // Download the file
                    https.get(fileUrl, (response) => {
                        response.pipe(fileStream);

                        fileStream.on('finish', () => {
                            fileStream.close();
                            console.log(`Downloaded: ${filename}`);
                            upload(contentValue);
                        });
                    });

                    // Save the new data
                    fs.writeFileSync(dataFilePath, JSON.stringify(jsonData, null, 2));

                    // You could add additional actions here like sending notifications
                } else {
                    console.log(getTimeAgo(lastModified))
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
async function upload(commit) {
    const zip = `${commit}.zip`;
    console.log(`Uploading: ${commit}.zip`);

    const result = await fetch(`https://${process.env.ARCHIVE_S3_HOST}/${process.env.ARCHIVE_S3_BUCKET}/${commit}.zip`, {
        method: "PUT",
        headers: {
            "User-Agent": "chromium-archive",
            "Authorization": `LOW ${process.env.ARCHIVE_S3_ACCESS_KEY}:${process.env.ARCHIVE_S3_SECRET_KEY}`
        },
        redirect: "follow",
        body: await fs.readFile(zip)
    });

    if (!result.ok) {
        throw new Error(`${result.status}: ${await result.text()}`);
    }

    await fs.rm(zip);
}

console.log(`Monitoring started. Checking every ${checkInterval / 1000} seconds.`);