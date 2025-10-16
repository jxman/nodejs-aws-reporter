/**
 * Archive Manager Module
 *
 * Handles uploading reports to S3 and managing archive retention.
 */

const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { generateTimestampedFilename } = require('./utils');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Upload Excel reports to S3 (both latest and archive)
 * @param {Buffer} excelBuffer - Excel file buffer
 * @param {string} bucket - S3 bucket name
 * @param {string} reportPrefix - Prefix for reports folder
 * @param {string} archivePrefix - Prefix for archive folder
 * @param {string} latestReportName - Name for latest report
 * @returns {Promise<Object>} Upload metadata
 */
async function uploadReports(excelBuffer, bucket, reportPrefix, archivePrefix, latestReportName) {
    // Generate archive filename with timestamp
    const archiveFileName = generateTimestampedFilename('aws-service-report', '.xlsx');

    // Upload latest report
    const latestKey = `${reportPrefix}${latestReportName}`;
    await uploadToS3(bucket, latestKey, excelBuffer);

    // Upload archive report
    const archiveKey = `${archivePrefix}${archiveFileName}`;
    await uploadToS3(bucket, archiveKey, excelBuffer);

    return {
        latestReportFile: latestReportName,
        latestReportPath: `s3://${bucket}/${latestKey}`,
        latestReportKey: latestKey,
        archiveReportFile: archiveFileName,
        archiveReportPath: `s3://${bucket}/${archiveKey}`,
        archiveReportKey: archiveKey
    };
}

/**
 * Upload buffer to S3 with retry logic
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @param {Buffer} buffer - File buffer
 * @param {number} maxRetries - Maximum number of retries
 */
async function uploadToS3(bucket, key, buffer, maxRetries = 3) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const command = new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: buffer,
                ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                ServerSideEncryption: 'AES256'
            });

            await s3Client.send(command);
            console.log(`✅ Uploaded: s3://${bucket}/${key}`);
            return;  // Success
        } catch (error) {
            lastError = error;
            console.error(`⚠️ Upload attempt ${attempt} failed for ${key}:`, error.message);

            if (attempt < maxRetries) {
                // Exponential backoff
                const delay = Math.pow(2, attempt) * 1000;
                console.log(`   Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    // All retries failed
    throw new Error(`Failed to upload ${key} after ${maxRetries} attempts: ${lastError.message}`);
}

/**
 * Manage archive retention - delete reports older than retention period
 * @param {string} bucket - S3 bucket name
 * @param {string} archivePrefix - Prefix for archive folder
 * @param {number} retentionDays - Number of days to retain archives
 * @returns {Promise<Object>} Retention management results
 */
async function manageArchiveRetention(bucket, archivePrefix, retentionDays) {
    try {
        // List all objects in archive folder
        const listCommand = new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: archivePrefix
        });

        const response = await s3Client.send(listCommand);
        const objects = response.Contents || [];

        if (objects.length === 0) {
            console.log('📂 No archived reports found');
            return { retained: 0, deleted: 0 };
        }

        // Calculate cutoff date
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        // Separate retained and expired objects
        const expiredObjects = [];
        const retainedObjects = [];

        objects.forEach(obj => {
            if (obj.LastModified < cutoffDate) {
                expiredObjects.push(obj);
            } else {
                retainedObjects.push(obj);
            }
        });

        console.log(`📂 Found ${objects.length} archived reports (${retainedObjects.length} retained, ${expiredObjects.length} expired)`);

        // Delete expired objects
        let deletedCount = 0;
        for (const obj of expiredObjects) {
            try {
                const deleteCommand = new DeleteObjectCommand({
                    Bucket: bucket,
                    Key: obj.Key
                });

                await s3Client.send(deleteCommand);
                console.log(`🗑️ Deleted expired archive: ${obj.Key}`);
                deletedCount++;
            } catch (error) {
                console.error(`⚠️ Failed to delete ${obj.Key}:`, error.message);
            }
        }

        return {
            retained: retainedObjects.length,
            deleted: deletedCount
        };

    } catch (error) {
        console.error('❌ Archive retention management error:', error);
        throw new Error(`Archive retention management failed: ${error.message}`);
    }
}

module.exports = {
    uploadReports,
    manageArchiveRetention
};
