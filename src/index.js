/**
 * AWS Service Report Generator - Lambda Handler
 *
 * Generates Excel reports from AWS infrastructure data stored in S3.
 * Implements automatic retention management and SNS notifications.
 */

const { readSourceData, readServicesData } = require('./s3Operations');
const { generateExcelReport } = require('./excelGenerator');
const { uploadReports, manageArchiveRetention, distributeReports } = require('./archiveManager');
const { sendSuccessNotification, sendFailureNotification, sendWarningNotification } = require('./snsNotifications');
const { formatDuration, formatFileSize } = require('./utils');

/**
 * Main Lambda handler
 * @param {Object} event - Lambda event (S3 event or manual invocation)
 * @param {Object} context - Lambda context
 * @returns {Object} Response object
 */
exports.handler = async (event, context) => {
  const startTime = Date.now();

  console.log('📊 AWS Service Report Generator starting...');
  console.log('Event:', JSON.stringify(event, null, 2));

  // Environment variables
  const config = {
    sourceBucket: process.env.SOURCE_BUCKET,
    sourceKey: process.env.SOURCE_KEY,
    reportBucket: process.env.REPORT_BUCKET,
    reportPrefix: process.env.REPORT_PREFIX,
    archivePrefix: process.env.ARCHIVE_PREFIX,
    latestReportName: process.env.LATEST_REPORT_NAME,
    archiveRetentionDays: parseInt(process.env.ARCHIVE_RETENTION_DAYS || '7'),
    snsTopicArn: process.env.SNS_TOPIC_ARN,
    distributionBucket: process.env.DISTRIBUTION_BUCKET,
    distributionKey: process.env.DISTRIBUTION_KEY,
    region: process.env.AWS_REGION || 'us-east-1',
    functionArn: context.invokedFunctionArn
  };

  console.log('Configuration:', JSON.stringify(config, null, 2));

  let sourceData;
  let excelBuffer;
  let reportMetadata = {};
  let archiveManagementWarning = null;

  try {
    // Step 1: Read source data from S3
    console.log(`📁 Reading source data from s3://${config.sourceBucket}/${config.sourceKey}`);
    sourceData = await readSourceData(config.sourceBucket, config.sourceKey);

    // Step 1b: Read services with names from services.json
    console.log(`📁 Reading service definitions from s3://${config.sourceBucket}/aws-data/services.json`);
    const servicesWithNames = await readServicesData(config.sourceBucket, 'aws-data/services.json');

    // Step 2: Validate data structure
    console.log('✅ Validating data structure...');
    if (!sourceData.metadata || !sourceData.regions || !sourceData.services) {
      throw new Error('Invalid data structure: missing required fields (metadata, regions, or services)');
    }

    // Extract arrays from nested structure
    const regions = sourceData.regions.regions || sourceData.regions;
    const serviceCodes = sourceData.services.services || sourceData.services;

    // Create service code to name mapping
    const serviceMap = new Map();
    servicesWithNames.forEach(service => {
      serviceMap.set(service.code, service.name);
    });

    // Enrich service codes with names
    const services = serviceCodes.map(code => ({
      code,
      name: serviceMap.get(code) || code // Fallback to code if name not found
    }));

    // Extract servicesByRegion - it's nested under .byRegion
    const servicesByRegionRaw = sourceData.servicesByRegion?.byRegion || sourceData.servicesByRegion || {};

    // Convert servicesByRegion from nested object to simple region->service codes mapping
    const servicesByRegion = {};
    Object.keys(servicesByRegionRaw).forEach(regionCode => {
      const regionData = servicesByRegionRaw[regionCode];
      // Handle both array format and object with .services property
      if (Array.isArray(regionData)) {
        servicesByRegion[regionCode] = regionData;
      } else if (regionData.services && Array.isArray(regionData.services)) {
        servicesByRegion[regionCode] = regionData.services;
      }
    });

    console.log(`📈 Data loaded: ${regions.length} regions, ${services.length} services, ${Object.keys(servicesByRegion).length} regions with service mappings`);

    // Step 3: Generate Excel workbook
    console.log('📊 Generating Excel report...');
    const excelStartTime = Date.now();
    // Normalize data structure for Excel generator
    const normalizedData = {
      metadata: sourceData.metadata,
      regions,
      services,
      servicesByRegion
    };
    excelBuffer = await generateExcelReport(normalizedData);
    const excelDuration = Date.now() - excelStartTime;

    console.log(`✅ Excel generated in ${formatDuration(excelDuration)}, size: ${formatFileSize(excelBuffer.length)}`);

    // Step 4: Upload reports to S3
    console.log('📤 Uploading reports to S3...');
    reportMetadata = await uploadReports(
      excelBuffer,
      config.reportBucket,
      config.reportPrefix,
      config.archivePrefix,
      config.latestReportName
    );

    console.log('✅ Reports uploaded successfully');
    console.log(`  - Latest: ${reportMetadata.latestReportPath}`);
    console.log(`  - Archive: ${reportMetadata.archiveReportPath}`);

    // Step 5: Distribute to public bucket (non-critical)
    const distributionResult = await distributeReports(
      config.reportBucket,
      `${config.reportPrefix}${config.latestReportName}`,
      config.distributionBucket,
      config.distributionKey
    );
    reportMetadata.distributionResult = distributionResult;

    // Step 6: Manage archive retention (non-critical)
    console.log(`🗂️ Managing archive retention (${config.archiveRetentionDays} days)...`);
    try {
      const retentionResult = await manageArchiveRetention(
        config.reportBucket,
        config.archivePrefix,
        config.archiveRetentionDays
      );

      console.log(`✅ Archive retention: ${retentionResult.retained} retained, ${retentionResult.deleted} deleted`);
      reportMetadata.archivedReportsRetained = retentionResult.retained;
      reportMetadata.archivedReportsDeleted = retentionResult.deleted;
    } catch (retentionError) {
      console.warn('⚠️ Archive retention management failed (non-critical):', retentionError.message);
      archiveManagementWarning = retentionError.message;
      reportMetadata.archivedReportsRetained = 'Unknown';
      reportMetadata.archivedReportsDeleted = 0;
    }

    // Step 7: Calculate metrics
    const totalDuration = Date.now() - startTime;
    const successMetrics = {
      processingTime: formatDuration(totalDuration),
      processingTimeMs: totalDuration,
      excelGenerationTime: formatDuration(excelDuration),
      reportSize: formatFileSize(excelBuffer.length),
      reportSizeBytes: excelBuffer.length,
      regionCount: regions.length,
      serviceCount: services.length,
      serviceMappingCount: servicesByRegion
        ? Object.keys(servicesByRegion).reduce((acc, region) =>
          acc + (servicesByRegion[region]?.length || 0), 0)
        : 0,
      dataSchemaVersion: sourceData.metadata.version || sourceData.metadata.schemaVersion || 'Unknown',
      dataTimestamp: sourceData.metadata.timestamp,
      ...reportMetadata
    };

    // Step 8: Send notifications
    if (archiveManagementWarning) {
      console.log('⚠️ Sending warning notification...');
      await sendWarningNotification(config.snsTopicArn, config.functionArn, successMetrics, archiveManagementWarning);
    } else {
      console.log('📧 Sending success notification...');
      await sendSuccessNotification(config.snsTopicArn, config.functionArn, successMetrics);
    }

    // Step 9: Structured logging
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message: 'Report generated successfully',
      ...successMetrics,
      snsNotificationSent: true
    }));

    // Step 10: Return success response
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Report generated successfully',
        ...successMetrics
      })
    };
  } catch (error) {
    // Error handling
    console.error('❌ Error generating report:', error);

    const totalDuration = Date.now() - startTime;
    const errorDetails = {
      error: error.message,
      errorType: error.name || 'UnknownError',
      stack: error.stack,
      processingTime: formatDuration(totalDuration),
      sourceBucket: config.sourceBucket,
      sourceKey: config.sourceKey
    };

    // Structured error logging
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      message: 'Report generation failed',
      ...errorDetails,
      snsNotificationSent: false
    }));

    // Send failure notification
    try {
      await sendFailureNotification(config.snsTopicArn, config.functionArn, errorDetails);
      console.log('📧 Failure notification sent');
    } catch (snsError) {
      console.error('Failed to send SNS notification:', snsError);
    }

    // Return error response
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Report generation failed',
        error: error.message,
        errorType: error.name || 'UnknownError'
      })
    };
  }
};
