# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**nodejs-aws-reporter** - AWS Lambda function that generates Excel reports from AWS infrastructure data. Processes data from the `aws-infrastructure-fetcher` project and creates comprehensive Excel reports with automatic retention management and SNS notifications.

**Key Features:**
- Automated daily report generation (triggers on S3 data updates)
- 4-sheet Excel reports (Summary, Regions, Services, Service Coverage)
- Smart retention: Latest + 7-day archive with automatic cleanup
- Email notifications with emojis and detailed metrics
- Production-ready error handling and monitoring

## Development Commands

### Setup
```bash
# Install dependencies (run from src/ directory)
cd src
npm install
cd ..

# Validate SAM template
sam validate
```

### Build and Deployment
```bash
# Build SAM application
sam build

# Deploy (first time with guided prompts)
sam deploy --guided

# Deploy (subsequent deploys)
sam deploy

# Delete stack and all resources
sam delete --stack-name aws-service-report-generator
```

### Testing
```bash
# Manual Lambda invocation
aws lambda invoke \
  --function-name aws-service-report-generator \
  --payload '{}' \
  response.json

# View response
cat response.json

# Verify reports in S3
aws s3 ls s3://aws-data-fetcher-output/reports/
aws s3 ls s3://aws-data-fetcher-output/reports/archive/

# Download latest report
aws s3 cp s3://aws-data-fetcher-output/reports/aws-service-report-latest.xlsx ./
```

### Monitoring
```bash
# Tail CloudWatch logs in real-time
sam logs --tail --stack-name aws-service-report-generator

# View logs from specific time
sam logs --start-time '10min ago' --stack-name aws-service-report-generator

# View logs directly
aws logs tail /aws/lambda/aws-service-report-generator --follow

# Check SNS subscriptions
aws sns list-subscriptions-by-topic --topic-arn <topic-arn>
```

## Project Architecture

### Directory Structure
```
nodejs-aws-reporter/
├── src/                        # Lambda function source code
│   ├── index.js               # Main Lambda handler
│   ├── s3Operations.js        # S3 read operations
│   ├── excelGenerator.js      # Excel workbook generation (4 sheets)
│   ├── archiveManager.js      # S3 upload & retention management
│   ├── snsNotifications.js    # SNS notifications (success/failure/warning)
│   └── utils.js               # Helper functions (formatting, dates)
├── template.yaml              # SAM template (CloudFormation)
├── DESIGN.md                  # Complete design specification
├── README.md                  # Usage instructions
└── package.json               # Dependencies
```

### Data Flow
1. **Trigger**: S3 event when `complete-data.json` is updated (daily ~2 AM UTC) or manual invocation
2. **Read**: Fetch source data from S3:
   - `aws-data-fetcher-output/aws-data/complete-data.json` (regions, service codes, mappings)
   - `aws-data-fetcher-output/aws-data/services.json` (full service names)
3. **Process**: Parse JSON, validate schema, merge service codes with names, normalize data structure
4. **Generate**: Create Excel workbook with 4 sheets using ExcelJS (with enhanced formatting and metrics)
5. **Upload**: Save to S3 (latest + timestamped archive)
6. **Retain**: Delete archives older than 7 days
7. **Notify**: Send SNS email with results and S3 paths

### Module Responsibilities

**index.js** - Main orchestrator
- Receives Lambda events (S3 or manual)
- Coordinates all operations
- Error handling and structured logging
- Metrics calculation and response formatting

**s3Operations.js** - S3 source data reading
- Reads `complete-data.json` from S3 (regions, service codes, mappings)
- Reads `services.json` from S3 (full service names)
- Streams to string conversion
- JSON parsing and validation

**excelGenerator.js** - Excel report generation
- Creates 4-sheet workbook with enhanced formatting:
  - **Summary**: EST/EDT timestamps for Report Generated and Data Timestamp
  - **Regions**: 6 columns including Service Count and formatted Launch Date (YYYY-MM-DD)
  - **Services**: 4 columns including Available Regions and Coverage % with color coding
  - **Service Coverage**: Matrix with green ✓ (available) and red ✗ (not available)
- N/A values displayed in gray italic for missing data
- Applies filters, frozen panes, hyperlinks
- Sorts services alphabetically by name
- Color-codes coverage percentages (green/light green/orange/red/gray)

**archiveManager.js** - Report storage and retention
- Uploads latest report (overwrites daily)
- Uploads archive report (timestamped)
- Lists archive folder contents
- Deletes reports older than retention period (7 days)
- Retry logic with exponential backoff

**snsNotifications.js** - Email notifications
- Success notifications (with S3 paths + metrics)
- Failure notifications (with troubleshooting steps)
- Warning notifications (non-critical issues)
- Emoji formatting and Unicode box-drawing characters

**utils.js** - Helper functions
- Duration formatting (ms → human-readable)
- File size formatting (bytes → KB/MB)
- Timestamp generation for filenames
- Date formatting (UTC and EST/EDT)
- `formatDateEST()`: Converts dates to Eastern Time with automatic DST detection

## Environment Variables

Lambda function environment variables (configured in template.yaml):
```
SOURCE_BUCKET=aws-data-fetcher-output
SOURCE_KEY=aws-data/complete-data.json
REPORT_BUCKET=aws-data-fetcher-output
REPORT_PREFIX=reports/
ARCHIVE_PREFIX=reports/archive/
LATEST_REPORT_NAME=aws-service-report-latest.xlsx
ARCHIVE_RETENTION_DAYS=7
SNS_TOPIC_ARN=<auto-generated by SAM>
NODE_ENV=production
AWS_REGION=us-east-1
```

## AWS Permissions Required

Lambda execution role has permissions for:
- **S3 Read**: `s3:GetObject` on `aws-data-fetcher-output/aws-data/*`
- **S3 Write**: `s3:PutObject`, `s3:DeleteObject` on `aws-data-fetcher-output/reports/*`
- **S3 List**: `s3:ListBucket` on `aws-data-fetcher-output` (for archive management)
- **SNS Publish**: `sns:Publish` on report notifications topic
- **CloudWatch Logs**: Standard Lambda logging permissions

## Data Contract

### Input Data (complete-data.json)
```json
{
  "metadata": {
    "schemaVersion": "1.4.0",
    "timestamp": "ISO-8601 format",
    "source": "AWS SSM Parameter Store"
  },
  "regions": [
    {
      "regionCode": "us-east-1",
      "regionName": "US East (N. Virginia)",
      "availabilityZones": [...],
      "launchDate": "2006-08-25",
      "blogUrl": "https://..."
    }
  ],
  "services": [
    {
      "serviceCode": "ec2",
      "serviceName": "Amazon Elastic Compute Cloud"
    }
  ],
  "servicesByRegion": {
    "us-east-1": ["ec2", "s3", "lambda", ...]
  }
}
```

**Expected Data Volume:**
- ~38 regions
- ~395 services
- ~15,000 service-by-region mappings
- File size: 400 KB

## Development Guidelines

### Code Organization
- **Modular design**: Each module has single responsibility
- **Error handling**: Comprehensive try-catch with specific error messages
- **Logging**: Structured JSON logging for CloudWatch Insights
- **Retry logic**: Exponential backoff for S3 uploads
- **Non-critical failures**: Archive retention failures don't fail report generation

### Excel Generation
- **Styling**: Use ExcelJS for headers, colors, fonts
- **Formatting**: Frozen panes, auto-filters, column widths
- **Hyperlinks**: Blog URLs in Regions sheet
- **Sorting**: Services alphabetically by name
- **Matrix view**: Service Coverage with checkmarks (✓)

### SNS Notifications
- **Emojis**: Strategic use for visual clarity (not excessive)
- **Formatting**: Unicode box-drawing for section dividers
- **Content**: Include S3 paths, metrics, troubleshooting steps
- **3 types**: Success, Failure, Warning

### S3 Operations
- **Retention management**: Automatic cleanup of archives >7 days old
- **Dual upload**: Both latest (overwrite) and archive (timestamped)
- **Error handling**: Retry uploads up to 3 times
- **Streaming**: Efficient stream-to-string conversion for large files

## Common Tasks

### Modifying Excel Report Structure
1. Edit `src/excelGenerator.js`
2. Modify specific sheet function (e.g., `createSummarySheet`)
3. Test locally or deploy and invoke
4. Download and verify Excel output

### Changing Retention Period
1. Update `ARCHIVE_RETENTION_DAYS` in `template.yaml`
2. Redeploy: `sam build && sam deploy`

### Adding New Notification Type
1. Add function to `src/snsNotifications.js`
2. Format message with emojis and sections
3. Call from `src/index.js` at appropriate point

### Updating Data Source
1. Modify `SOURCE_BUCKET` or `SOURCE_KEY` in `template.yaml`
2. Ensure IAM permissions include new path
3. Redeploy

### Debugging Failed Reports
1. Check CloudWatch logs: `sam logs --tail`
2. Review SNS failure notification email
3. Verify source file exists: `aws s3 ls s3://aws-data-fetcher-output/aws-data/complete-data.json`
4. Check Lambda function permissions
5. Manual invoke to reproduce issue

## S3 Event Trigger Configuration

After initial deployment, configure S3 to trigger Lambda:

```bash
# Get configuration command from stack outputs
aws cloudformation describe-stacks \
  --stack-name aws-service-report-generator \
  --query 'Stacks[0].Outputs[?OutputKey==`S3EventConfigurationCommand`].OutputValue' \
  --output text

# Execute the returned command to enable S3 trigger
```

## Monitoring and Alarms

### CloudWatch Alarms
- **Error Alarm**: Triggers on any Lambda errors (1 day period)
- **Timeout Alarm**: Triggers if duration >240s (4 minutes)

Both send SNS notifications to configured email.

### CloudWatch Metrics
- Lambda standard metrics (Invocations, Duration, Errors, Throttles)
- Custom structured logs for CloudWatch Insights queries

### Sample CloudWatch Insights Query
```
fields @timestamp, level, message, regionCount, serviceCount, processingTime
| filter level = "INFO"
| filter message = "Report generated successfully"
| sort @timestamp desc
| limit 20
```

## Related Projects

- **Data Source**: [aws-infrastructure-fetcher](https://github.com/jxman/aws-infrastructure-fetcher)
- **Data Contract**: [DATA_CONTRACT.md](https://github.com/jxman/aws-infrastructure-fetcher/blob/main/DATA_CONTRACT.md)

## Recent Enhancements (v1.3.0)

### Summary Sheet
- **EST/EDT Timestamps**: Both "Report Generated" and "Data Timestamp" now display in Eastern Time
- **Format**: YYYY-MM-DD HH:mm:ss EST/EDT (automatically detects daylight saving time)
- **Implementation**: `formatDateEST()` function in utils.js using Intl.DateTimeFormat API

### Regions Sheet
- **Service Count Column**: Shows number of services available per region (out of 395)
- **Formatted Launch Dates**: Consistent YYYY-MM-DD format instead of GMT string
- **N/A Values**: Missing dates and blog URLs show "N/A" in gray italic

### Services Sheet
- **Available Regions Column**: Count of regions where each service is available (out of 38)
- **Coverage % Column**: Percentage with color coding:
  - 100%: Green bold (fully available)
  - 75-99%: Light green
  - 50-74%: Orange
  - 1-49%: Red
  - 0%: Gray italic
- **Regional Coverage Analysis**: Quickly identify services with limited availability

### Service Coverage Sheet
- **Red X for Unavailable**: Services not available in a region show red ✗
- **Visual Indicators**: Green ✓ for available, red ✗ for not available
- **Enhanced Readability**: Color-coded matrix makes patterns easier to spot

### Data Processing
- **Dual Source Reading**: Now reads both complete-data.json and services.json
- **Service Name Merging**: Service codes enriched with full AWS service names
- **Data Normalization**: Handles nested structures and multiple field name patterns

## Notes for Claude Code

- **No linting configured yet**: npm run lint will echo message (add ESLint later if needed)
- **No tests yet**: Add unit tests for modules in Phase 2
- **SAM-based deployment**: Use `sam build` and `sam deploy`, not traditional npm scripts
- **Manual testing**: Always test Lambda invocation after code changes
- **Excel verification**: Download and open Excel file to verify formatting
- **Email notifications**: Check both success and failure scenarios
- **S3 paths**: Always use environment variables, never hardcode bucket/key names
- **Error handling**: Distinguish between critical failures (stop) and warnings (continue)
- **Archive retention**: Non-critical operation, log warnings but don't fail report generation
- **Date formatting**: Use date-fns for consistent formatting across all modules
- **Timezone handling**: EST/EDT conversion uses native Intl API, no external libraries needed
- **Color coding**: Use ExcelJS argb color format for consistent styling
- **N/A formatting**: Always style missing data as gray italic for visual consistency
