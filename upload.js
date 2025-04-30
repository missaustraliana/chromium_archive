import fsp from "fs/promises";

const host = process.env.ARCHIVE_S3_HOST;
const bucket = process.env.ARCHIVE_S3_BUCKET;
const accessKey = process.env.ARCHIVE_S3_ACCESS_KEY;
const secretKey = process.env.ARCHIVE_S3_SECRET_KEY;

export async function upload({ filePath, filename, chunkSize = 10, concurrency = 5, deleteAfterUpload = false }) {
  console.log(`Uploading: ${filePath} as ${filename}`);

  try {
    // Check if file exists
    try {
      await fsp.access(filePath);
    } catch (error) {
      console.error(`Error: File '${filePath}' not found or not accessible`);
      process.exit(1);
    }

    const fileSize = (await fsp.stat(filePath)).size;
    const chunkSizeBytes = chunkSize * 1024 * 1024; // Convert MB to bytes
    const numberOfChunks = Math.ceil(fileSize / chunkSizeBytes);

    console.log(`File size: ${fileSize} bytes, chunking into ${numberOfChunks} parts (${chunkSize}MB each)`);

    // Initialize multipart upload
    const initResult = await fetch(`https://${host}/${bucket}/${filename}?uploads`, {
      method: "POST",
      headers: {
        "User-Agent": "archive-uploader",
        "Authorization": `LOW ${accessKey}:${secretKey}`,
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

    // Upload parts with constant concurrency
    const parts = Array(numberOfChunks).fill(null);
    const fileHandle = await fsp.open(filePath, 'r');

    try {
      // Create a queue of part numbers to upload
      const queue = Array.from({ length: numberOfChunks }, (_, i) => i + 1);

      // Keep track of active uploads
      const active = new Set();

      // Process function will keep starting new uploads as long as we have capacity
      async function processQueue() {
        // Keep starting new uploads until we hit our concurrency limit
        while (queue.length > 0 && active.size < concurrency) {
          const partNumber = queue.shift();
          active.add(partNumber);

          // Calculate chunk boundaries
          const start = (partNumber - 1) * chunkSizeBytes;
          const chunkEnd = Math.min(fileSize, start + chunkSizeBytes);

          // Read the file chunk
          const buffer = Buffer.alloc(chunkEnd - start);
          await fileHandle.read(buffer, 0, buffer.length, start);

          console.log(`Uploading part ${partNumber}/${numberOfChunks} (${((chunkEnd - start) / 1024 / 1024).toFixed(2)}MB)`);

          // Start the upload and continue processing when it completes
          uploadPart(partNumber, buffer).then(result => {
            // Store the result
            parts[partNumber - 1] = result;

            // Remove from active set
            active.delete(partNumber);

            // Try to process more
            return processQueue();
          }).catch(error => {
            console.error(`Error uploading part ${partNumber}: ${error.message}`);
            throw error;
          });
        }
      }

      // Helper function to upload a single part
      async function uploadPart(partNumber, buffer) {
        const response = await fetch(
          `https://${host}/${bucket}/${filename}?partNumber=${partNumber}&uploadId=${uploadId}`,
          {
            method: "PUT",
            headers: {
              "User-Agent": "archive-uploader",
              "Authorization": `LOW ${accessKey}:${secretKey}`
            },
            body: buffer
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to upload part ${partNumber}: ${response.status}: ${await response.text()}`);
        }

        const etag = response.headers.get('ETag') || `"part${partNumber}"`;
        console.log(`Part ${partNumber} uploaded successfully`);
        return { PartNumber: partNumber, ETag: etag };
      }

      // Start the initial batch of uploads
      await processQueue();

      // Wait for all uploads to complete
      while (active.size > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
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
        `https://${host}/${bucket}/${filename}?uploadId=${uploadId}`,
        {
          method: "POST",
          headers: {
            "User-Agent": "archive-uploader",
            "Authorization": `LOW ${accessKey}:${secretKey}`,
            "Content-Type": "application/xml"
          },
          body: completeXml
        }
      );

      if (!completeResult.ok) {
        throw new Error(`Failed to complete upload: ${completeResult.status}: ${await completeResult.text()}`);
      }

      console.log(`Successfully uploaded ${filePath}`);
      console.log(`URL: https://${host}/${bucket}/${filename}`);

      if (deleteAfterUpload) {
        console.log(`Deleting local file: ${filePath}`);
        await fsp.rm(filePath);
      }

    } finally {
      await fileHandle.close();
    }
  } catch (error) {
    console.error(`Upload failed: ${error.message}`);
    process.exit(1);
  }
}
