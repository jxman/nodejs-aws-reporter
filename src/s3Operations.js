/**
 * S3 Operations Module
 *
 * Handles reading AWS infrastructure data from S3.
 */

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Read and parse source data from S3
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @returns {Promise<Object>} Parsed JSON data
 */
async function readSourceData(bucket, key) {
    try {
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key
        });

        const response = await s3Client.send(command);

        // Convert stream to string
        const bodyContents = await streamToString(response.Body);

        // Parse JSON
        const data = JSON.parse(bodyContents);

        return data;
    } catch (error) {
        if (error.name === 'NoSuchKey') {
            throw new Error(`Source file not found: s3://${bucket}/${key}`);
        } else if (error.name === 'SyntaxError') {
            throw new Error(`Invalid JSON format in source file: ${error.message}`);
        } else {
            throw new Error(`Failed to read source data from S3: ${error.message}`);
        }
    }
}

/**
 * Convert a stream to a string
 * @param {ReadableStream} stream - The stream to convert
 * @returns {Promise<string>} The stream content as a string
 */
async function streamToString(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
}

/**
 * Read service definitions with names from S3
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key (typically 'aws-data/services.json')
 * @returns {Promise<Array>} Array of service objects with code and name
 */
async function readServicesData(bucket, key) {
    try {
        const data = await readSourceData(bucket, key);
        // Extract services array from the response
        return data.services || [];
    } catch (error) {
        console.warn(`Warning: Could not read services data from ${key}: ${error.message}`);
        return [];
    }
}

module.exports = {
    readSourceData,
    readServicesData
};
