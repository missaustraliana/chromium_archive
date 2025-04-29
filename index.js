require('dotenv/config');
const https = require('https');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { get } = require('http');



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

    https.get(url, {
        family: 4,
        headers: {
            'User-Agent': 'chromium-archive'
        }
    }, (res) => {

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

    const fileSize = (await fsp.stat(zip)).size;
    const chunkSize = 5 * 1024 * 1024; // 5MB chunks
    const numberOfChunks = Math.ceil(fileSize / chunkSize);

    console.log(`File size: ${fileSize} bytes, chunking into ${numberOfChunks} parts`);

    // Initialize multipart upload
    const initResult = await fetch(`https://${process.env.ARCHIVE_S3_HOST}/${process.env.ARCHIVE_S3_BUCKET}/${commit}.zip?uploads`, {
        method: "POST",
        headers: {
            "User-Agent": "chromium-archive",
            "Authorization": `LOW ${process.env.ARCHIVE_S3_ACCESS_KEY}:${process.env.ARCHIVE_S3_SECRET_KEY}`,
            "x-archive-queue-derive": "0",
            "x-archive-interactive-priority": "1",
            "x-archive-size-hint": `${fileSize}`
        }
    });

    if (!initResult.ok) {
        throw new Error(`Failed to initialize upload: ${initResult.status}: ${await initResult.text()}`);
    }

    const initData = await initResult.text();
    const uploadId = initData.match(/<UploadId>(.*?)<\/UploadId>/)?.[1];

    if (!uploadId) {
        throw new Error("Failed to get upload ID");
    }

    // Upload parts with concurrency limit of 5
    const parts = [];
    const fileHandle = await fsp.open(zip, 'r');
    const concurrencyLimit = 10;

    try {
        for (let i = 0; i < numberOfChunks; i += concurrencyLimit) {
            const chunkPromises = [];
            const end = Math.min(i + concurrencyLimit, numberOfChunks);

            for (let j = i; j < end; j++) {
                const start = j * chunkSize;
                const chunkEnd = Math.min(fileSize, start + chunkSize);
                const partNumber = j + 1;

                const buffer = Buffer.alloc(chunkEnd - start);
                await fileHandle.read(buffer, 0, buffer.length, start);

                console.log(`Uploading part ${partNumber}/${numberOfChunks}`);

                const partPromise = fetch(
                    `https://${process.env.ARCHIVE_S3_HOST}/${process.env.ARCHIVE_S3_BUCKET}/${commit}.zip?partNumber=${partNumber}&uploadId=${uploadId}`,
                    {
                        method: "PUT",
                        headers: {
                            "User-Agent": "chromium-archive",
                            "Authorization": `LOW ${process.env.ARCHIVE_S3_ACCESS_KEY}:${process.env.ARCHIVE_S3_SECRET_KEY}`
                        },
                        body: buffer
                    }
                ).then(async (res) => {
                    if (!res.ok) {
                        throw new Error(`Failed to upload part ${partNumber}: ${res.status}: ${await res.text()}`);
                    }
                    const etag = res.headers.get('ETag') || `"part${partNumber}"`;
                    return { PartNumber: partNumber, ETag: etag };
                });

                chunkPromises.push(partPromise);
            }

            // Wait for the current batch to complete before starting the next batch
            const batchResults = await Promise.all(chunkPromises);
            parts.push(...batchResults);
        }

        // Complete multipart upload
        const completeXml = `
            <CompleteMultipartUpload>
                ${parts.map(part => `<Part>
                    <PartNumber>${part.PartNumber}</PartNumber>
                    <ETag>${part.ETag}</ETag>
                </Part>`).join('')}
            </CompleteMultipartUpload>
        `;

        const completeResult = await fetch(
            `https://${process.env.ARCHIVE_S3_HOST}/${process.env.ARCHIVE_S3_BUCKET}/${commit}.zip?uploadId=${uploadId}`,
            {
                method: "POST",
                headers: {
                    "User-Agent": "chromium-archive",
                    "Authorization": `LOW ${process.env.ARCHIVE_S3_ACCESS_KEY}:${process.env.ARCHIVE_S3_SECRET_KEY}`,
                    "Content-Type": "application/xml"
                },
                body: completeXml
            }
        );

        if (!completeResult.ok) {
            throw new Error(`Failed to complete upload: ${completeResult.status}: ${await completeResult.text()}`);
        }

        console.log(`Successfully uploaded ${commit}.zip`);
    } finally {
        await fileHandle.close();
    }

    await fsp.rm(zip);
}

console.log(`Monitoring started. Checking every ${checkInterval / 1000} seconds.`);
