# AWS Service Reporting Application - Design Document

## Project Overview

An AWS-based reporting system that processes AWS infrastructure data and generates Excel reports. The system reads data from the `aws-data-fetcher-output` S3 bucket and produces consolidated Excel reports.

**Version:** 1.3.0 - Enhanced Implementation
**Last Updated:** 2025-10-16
**Data Fetcher Schedule:** Daily at 2 AM UTC (~13 seconds with caching)
**Deployment Region:** us-east-1
**Notification Email:** jxman@hotmail.com

---

## Architecture Overview

```
┌─────────────────────┐
│   S3 Source Bucket  │
│ aws-data-fetcher-   │
│      output         │
│  /aws-data/*.json   │
└──────────┬──────────┘
           │
           │ (1) S3 Event (daily 2 AM) or Manual Trigger
           │
           ▼
┌─────────────────────┐
│  Lambda Function    │
│  Report Generator   │
│  (Node.js 20.x)     │
└──────┬──────────────┘
       │
       │ (2) Reads complete-data.json
       │ (3) Generates Excel report
       │ (4) Manages retention (latest + 7-day archive)
       │
       ├────────────────────────────┐
       ▼                            ▼
┌─────────────────────┐    ┌─────────────────────┐
│ S3 Reports Bucket   │    │    SNS Topic        │
│  /reports/          │    │ (Success/Failure)   │
│  latest.xlsx        │    │  Email Alerts       │
│  /archive/*.xlsx    │    └─────────────────────┘
└─────────────────────┘
```

---

## Data Source Details

### Source Location
- **S3 Bucket:** `s3://aws-data-fetcher-output/aws-data/`
- **Schema Version:** 1.4.0
- **Data Format:** JSON

### Source Files

#### 1. complete-data.json (Primary Source)
**Size:** ~12KB (no mapping), ~400KB (with service-by-region mapping)

**Structure:**
```json
{
  "metadata": {
    "schemaVersion": "1.4.0",
    "timestamp": "ISO-8601 format",
    "source": "AWS SSM Parameter Store"
  },
  "regions": [...],
  "services": [...],
  "servicesByRegion": {...}  // Optional
}
```

**Key Data Points:**
- **Regions:** Region code, name, availability zones, launch date
- **Services:** Service code, official service names
- **Service-by-Region Mapping:** Which services are available in which regions

#### 2. regions.json (Secondary)
**Size:** ~8KB
**Contains:** Region metadata only

#### 3. services.json (Required)
**Size:** ~32KB
**Contains:** Full service definitions with codes and names

**Structure:**
```json
{
  "count": 395,
  "services": [
    {"code": "s3", "name": "Amazon Simple Storage Service"},
    {"code": "ec2", "name": "Amazon Elastic Compute Cloud"}
  ],
  "source": "ssm",
  "timestamp": "ISO-8601 format"
}
```

### Data Reading Strategy
**Current Implementation:** Reads **both** `complete-data.json` AND `services.json`
- `complete-data.json`: Provides regions and service codes for compactness
- `services.json`: Provides full service names for display
- Service codes are merged with names during processing

---

## Lambda Function Design

### Function Specifications

**Name:** `aws-service-report-generator`

**Runtime:** Node.js 20.x (LTS, v18 approaching EOL)

**Memory:** 512 MB (adjustable based on data size)

**Timeout:** 5 minutes (300 seconds)

**Architecture:** arm64 (Graviton2 for cost optimization)

### Function Workflow

```
START
  │
  ├─→ [1] Receive Event (S3 trigger at 2 AM UTC or manual invocation)
  │
  ├─→ [2] Read complete-data.json from source S3 bucket
  │
  ├─→ [3] Parse and validate JSON data
  │       ├─ Check schema version (1.4.0)
  │       └─ Validate required fields
  │       └─ [On Error: Send SNS failure notification → END]
  │
  ├─→ [4] Process Data
  │       ├─ Extract regions data (~38 regions)
  │       ├─ Extract services data (~395+ services)
  │       └─ Extract service-by-region mapping (if available)
  │
  ├─→ [5] Generate Excel Workbook
  │       ├─ Create "Summary" sheet with metadata
  │       ├─ Create "Regions" sheet (38 rows)
  │       ├─ Create "Services" sheet (395+ rows)
  │       └─ Create "Service Coverage" sheet (matrix view)
  │
  ├─→ [6] Format Excel
  │       ├─ Apply headers and styling
  │       ├─ Set column widths and frozen panes
  │       └─ Add filters and hyperlinks
  │       └─ [On Error: Send SNS failure notification → END]
  │
  ├─→ [7] Generate filenames
  │       ├─ Latest: aws-service-report-latest.xlsx
  │       └─ Archive: aws-service-report-YYYY-MM-DD-HHmmss.xlsx
  │
  ├─→ [8] Upload to S3 reporting bucket
  │       ├─ Upload latest report → reports/aws-service-report-latest.xlsx
  │       └─ Upload archived report → reports/archive/aws-service-report-YYYY-MM-DD-HHmmss.xlsx
  │
  ├─→ [9] Manage Archive Retention
  │       ├─ List all files in reports/archive/
  │       ├─ Sort by date (oldest first)
  │       └─ Delete reports older than 7 days
  │
  ├─→ [10] Send SNS Success Notification
  │       ├─ Use emojis for headings and key information
  │       ├─ Report S3 paths (latest + archive with clickable links)
  │       ├─ Data statistics (region count, service count)
  │       ├─ Processing duration and file size
  │       └─ Timestamp and execution details
  │
  └─→ [11] Return success response
END
```

### NPM Dependencies

```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.x",
    "@aws-sdk/client-sns": "^3.x",
    "exceljs": "^4.x",
    "date-fns": "^3.x"
  }
}
```

**Rationale:**
- **@aws-sdk/client-s3:** Modern AWS SDK v3 (modular, smaller bundle size)
- **@aws-sdk/client-sns:** SNS client for success/failure notifications
- **exceljs:** Comprehensive Excel generation library with styling support
- **date-fns:** Lightweight date formatting utilities (v3 for Node.js 20)

---

## Excel Report Structure

### Workbook: `aws-service-report-YYYY-MM-DD-HHmmss.xlsx`

#### Sheet 1: Summary
**Purpose:** High-level overview and metadata with Eastern Time timestamps

| Field | Value |
|-------|-------|
| Report Generated | 2025-10-16 10:53:26 EDT |
| Data Source | s3://aws-data-fetcher-output/aws-data/complete-data.json |
| Schema Version | 1.4.0 |
| Data Timestamp | 2025-10-15 22:00:10 EDT |
| Total AWS Regions | 38 |
| Total AWS Services | 395 |
| Service-by-Region Mappings | 8,643 |

**Features:**
- EST/EDT timezone formatting (YYYY-MM-DD HH:mm:ss EST/EDT)
- Automatic daylight saving time detection
- Clean, professional layout

#### Sheet 2: Regions
**Purpose:** Complete list of 38 AWS regions with service availability

| Region Code | Region Name | Availability Zones | Service Count | Launch Date | Blog URL |
|-------------|-------------|-------------------|---------------|-------------|----------|
| us-east-1 | US East (N. Virginia) | 6 | 227 | 2006-08-25 | [link] |
| eu-west-1 | Europe (Ireland) | 3 | 225 | 2008-12-10 | [link] |
| ap-south-1 | Asia Pacific (Mumbai) | 3 | 210 | 2016-06-27 | N/A |
| ... | ... | ... | ... | ... | ... |

**Features:**
- **Service Count**: Number of services available in each region (out of 395)
- **Launch Date**: Formatted as YYYY-MM-DD
- **N/A values**: Gray italic for missing data (dates and blog URLs)
- Sortable columns
- Frozen header row
- Auto-filter enabled
- Clickable blog URL hyperlinks

#### Sheet 3: Services
**Purpose:** All 395 AWS services with regional coverage analysis

| Service Code | Service Name | Available Regions | Coverage % |
|--------------|--------------|------------------|------------|
| s3 | Amazon Simple Storage Service | 38 | 100.0% |
| lambda | AWS Lambda | 36 | 94.7% |
| ec2 | Amazon Elastic Compute Cloud | 38 | 100.0% |
| ... | ... | ... | ... |

**Features:**
- **Available Regions**: Count of regions where service is available (out of 38)
- **Coverage %**: Percentage with color coding:
  - 100%: Green bold (available everywhere)
  - 75-99%: Light green (broad availability)
  - 50-74%: Orange (moderate availability)
  - 1-49%: Red (limited availability)
  - 0%: Gray italic (not available)
- Alphabetically sorted by service name
- Frozen header row
- Auto-filter enabled

#### Sheet 4: Service Coverage
**Purpose:** Comprehensive service availability matrix

**Layout:** 395 services (rows) × 38 regions (columns) = 15,010 cells

| Service | us-east-1 | eu-west-1 | ap-southeast-1 | ... |
|---------|-----------|-----------|----------------|-----|
| Amazon S3 | ✓ | ✓ | ✓ | ... |
| AWS Lambda | ✓ | ✓ | ✗ | ... |
| Amazon EC2 | ✓ | ✓ | ✓ | ... |
| ... | ... | ... | ... | ... |

**Features:**
- **Available**: Green checkmark (✓) with bold formatting
- **Not Available**: Red X (✗) with bold formatting
- Frozen first column and header row
- Auto-filter enabled
- Region columns dynamically generated
- Visual at-a-glance availability indicators

---

## S3 Bucket Structure

### Source Bucket: `aws-data-fetcher-output`

```
aws-data-fetcher-output/
├── aws-data/
│   ├── complete-data.json         (PRIMARY - Updated daily at 2 AM UTC)
│   ├── regions.json                (Secondary)
│   ├── services.json               (Secondary)
│   ├── cache/                      (Service-by-region cache data)
│   └── history/                    (30-day historical snapshots)
└── reports/
    ├── aws-service-report-latest.xlsx       (Current report, overwritten daily)
    └── archive/
        ├── aws-service-report-2025-10-14-020500.xlsx
        ├── aws-service-report-2025-10-13-020500.xlsx
        ├── aws-service-report-2025-10-12-020500.xlsx
        ├── aws-service-report-2025-10-11-020500.xlsx
        ├── aws-service-report-2025-10-10-020500.xlsx
        ├── aws-service-report-2025-10-09-020500.xlsx
        └── aws-service-report-2025-10-08-020500.xlsx  (7 days retained)
```

### Bucket Configuration

**Versioning:** Enabled (for data integrity and recovery)

**Lifecycle Policy:**
- **reports/archive/:** Lambda manages retention (7 days, programmatic deletion)
- **reports/aws-service-report-latest.xlsx:** No lifecycle policy (always current)
- **Note:** No S3 lifecycle rules needed - Lambda handles all retention

**Encryption:** AES-256 (SSE-S3) or KMS (for enhanced security)

**Access Logging:** Enabled for audit trail

**Report Retention Strategy:**
- **Latest Report:** Always available at `reports/aws-service-report-latest.xlsx`
- **Archive Reports:** 7 days of historical reports in `reports/archive/`
- **Retention Logic:** Lambda deletes archives older than 7 days on each execution
- **Benefits:**
  - Quick access to current report (no timestamp needed)
  - 7-day historical window for comparison
  - Automated cleanup prevents storage bloat

---

## Trigger Mechanisms

### Option 1: S3 Event Trigger (Automated)

**Configuration:**
- **Event Type:** `s3:ObjectCreated:Put`
- **Bucket:** `aws-data-fetcher-output`
- **Prefix:** `aws-data/`
- **Suffix:** `complete-data.json`

**Behavior:**
- Lambda automatically invoked when `complete-data.json` is updated
- Event payload includes bucket name and object key
- Near real-time report generation

**Pros:**
- Automated, no manual intervention
- Reports always reflect latest data
- Event-driven architecture

**Cons:**
- Triggered every time file is updated (could generate many reports)
- No control over execution timing

### Option 2: Manual Invocation

**Method 1: AWS Console**
- Navigate to Lambda function
- Click "Test" button
- Provide empty test event `{}`

**Method 2: AWS CLI**
```bash
aws lambda invoke \
  --function-name aws-service-report-generator \
  --payload '{}' \
  response.json
```

**Method 3: EventBridge Scheduled Rule**
```
Schedule: cron(0 9 * * ? *)  # Daily at 9:00 AM UTC
Target: aws-service-report-generator Lambda function
```

**Pros:**
- Full control over execution timing
- Can be scheduled (daily, weekly, on-demand)
- Prevents unnecessary executions

**Cons:**
- Requires manual action or scheduler setup
- Reports may not reflect latest data immediately

### Recommended Approach

**✅ CONFIRMED: Hybrid Model**
1. **Primary:** S3 event trigger for automatic report generation (daily at ~2:05 AM UTC)
2. **Secondary:** Manual invocation capability for testing and ad-hoc reports

**Why This Works:**
- Data fetcher runs daily at 2 AM UTC and completes in ~13 seconds
- Report generator triggers automatically via S3 event at ~2:05 AM
- Manual invocation available for testing without waiting for daily schedule
- No EventBridge scheduler needed (data fetcher already scheduled)

---

## IAM Permissions

### Lambda Execution Role

**Role Name:** `AWSServiceReportGeneratorRole`

**Trust Policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

**Required Policies:**

#### 1. S3 Read Access (Source Data)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::aws-data-fetcher-output/aws-data/*"
    }
  ]
}
```

#### 2. S3 Write Access (Reports)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl",
        "s3:ListBucket",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::aws-data-fetcher-output/reports/*",
        "arn:aws:s3:::aws-data-fetcher-output"
      ]
    }
  ]
}
```

**Note:** `ListBucket` and `DeleteObject` required for 7-day archive retention management.

#### 3. CloudWatch Logs (Standard)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

**Note:** Attach AWS managed policy `AWSLambdaBasicExecutionRole` or use the CloudWatch Logs policy above.

#### 4. SNS Publish Access (Notifications)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sns:Publish"
      ],
      "Resource": "arn:aws:sns:*:*:aws-service-report-notifications"
    }
  ]
}
```

**Note:** SNS topic name: `aws-service-report-notifications`

---

## Error Handling & Logging

### Error Scenarios

1. **S3 Source File Not Found**
   - Log error with bucket and key details
   - Send SNS failure notification with error details
   - Return HTTP 404 equivalent error

2. **Invalid JSON Format**
   - Log parsing error with details
   - Send SNS failure notification with validation errors
   - Return HTTP 400 equivalent error

3. **Schema Version Mismatch**
   - Log warning if schema version differs from expected
   - Attempt to process anyway (backward compatibility)
   - Include version info in report summary

4. **Excel Generation Failure**
   - Log stack trace
   - Send SNS failure notification with error details
   - Return HTTP 500 equivalent error
   - Include data size and memory usage

5. **S3 Upload Failure**
   - Log error with bucket/key details
   - Retry up to 3 times with exponential backoff
   - Send SNS failure notification if all retries fail
   - Return HTTP 500 equivalent error

6. **Archive Retention Management Failure**
   - Log warning (non-critical, don't fail report generation)
   - Send SNS warning notification
   - Continue with report generation

### Logging Strategy

**CloudWatch Log Groups:**
- **Log Group:** `/aws/lambda/aws-service-report-generator`
- **Retention:** 30 days (adjustable)

**Log Levels:**
- **INFO:** Normal execution flow, report generation success
- **WARN:** Schema version mismatch, missing optional data
- **ERROR:** Failures that prevent report generation
- **DEBUG:** Detailed data processing steps (disabled in production)

**Structured Logging Examples:**

**Success:**
```json
{
  "timestamp": "2025-10-14T02:05:00Z",
  "level": "INFO",
  "message": "Report generated successfully",
  "latestReportFile": "aws-service-report-latest.xlsx",
  "latestReportS3Path": "s3://aws-data-fetcher-output/reports/aws-service-report-latest.xlsx",
  "archiveReportFile": "aws-service-report-2025-10-14-020500.xlsx",
  "archiveReportS3Path": "s3://aws-data-fetcher-output/reports/archive/aws-service-report-2025-10-14-020500.xlsx",
  "dataSize": "415KB",
  "processingTime": "2.3s",
  "regionCount": 38,
  "serviceCount": 395,
  "archivedReportsRetained": 7,
  "archivedReportsDeleted": 1,
  "snsNotificationSent": true
}
```

**Failure:**
```json
{
  "timestamp": "2025-10-14T02:05:00Z",
  "level": "ERROR",
  "message": "Report generation failed",
  "error": "S3 source file not found",
  "errorType": "SourceFileNotFound",
  "bucket": "aws-data-fetcher-output",
  "key": "aws-data/complete-data.json",
  "snsNotificationSent": true
}
```

---

## SNS Notification Format

### Success Notification Template

**Subject:** ✅ AWS Service Report Generated Successfully

**Message Body:**
```
✅ AWS Service Report Generation Complete

📊 Report Details
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Generated: 2025-10-14 02:05:23 UTC
• Processing Time: 2.3 seconds
• Report Size: 415 KB

📁 Report Locations
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Latest Report:
s3://aws-data-fetcher-output/reports/aws-service-report-latest.xlsx

Archive Report:
s3://aws-data-fetcher-output/reports/archive/aws-service-report-2025-10-14-020523.xlsx

📈 Data Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• AWS Regions: 38
• AWS Services: 395
• Service-by-Region Mappings: 15,010
• Data Schema Version: 1.4.0
• Data Timestamp: 2025-10-14 02:00:15 UTC

📂 Archive Management
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Reports Retained: 7 days
• Reports Deleted: 1 (older than 7 days)

---
Generated by aws-service-report-generator
Lambda Function: arn:aws:lambda:us-east-1:123456789012:function:aws-service-report-generator
```

### Failure Notification Template

**Subject:** ❌ AWS Service Report Generation Failed

**Message Body:**
```
❌ AWS Service Report Generation Failed

⚠️ Error Details
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Error Type: SourceFileNotFound
• Error Message: S3 source file not found
• Timestamp: 2025-10-14 02:05:23 UTC

📁 Source File
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Bucket: aws-data-fetcher-output
• Key: aws-data/complete-data.json
• Full Path: s3://aws-data-fetcher-output/aws-data/complete-data.json

🔍 Troubleshooting Steps
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Verify the source file exists in S3
2. Check aws-infrastructure-fetcher Lambda execution logs
3. Verify data fetcher completed successfully at 2 AM UTC
4. Check S3 bucket permissions
5. Review CloudWatch logs for detailed error trace

📊 CloudWatch Logs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Log Group: /aws/lambda/aws-service-report-generator
Log Stream: 2025/10/14/[$LATEST]abcd1234

---
Generated by aws-service-report-generator
Lambda Function: arn:aws:lambda:us-east-1:123456789012:function:aws-service-report-generator
```

### Warning Notification Template (Non-Critical Issues)

**Subject:** ⚠️ AWS Service Report Generated with Warnings

**Message Body:**
```
⚠️ AWS Service Report Generated with Warnings

✅ Report Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Report was generated successfully, but some non-critical issues occurred.

📁 Report Locations
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Latest Report:
s3://aws-data-fetcher-output/reports/aws-service-report-latest.xlsx

Archive Report:
s3://aws-data-fetcher-output/reports/archive/aws-service-report-2025-10-14-020523.xlsx

⚠️ Warning Details
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Issue: Archive retention cleanup partially failed
• Details: Could not delete 1 archived report
• Impact: Low - Manual cleanup may be needed eventually
• Timestamp: 2025-10-14 02:05:23 UTC

📈 Data Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• AWS Regions: 38
• AWS Services: 395
• Processing Time: 2.3 seconds
• Report Size: 415 KB

---
Generated by aws-service-report-generator
Lambda Function: arn:aws:lambda:us-east-1:123456789012:function:aws-service-report-generator
```

### Notification Design Guidelines

**Emoji Usage:**
- ✅ Success indicator
- ❌ Failure indicator
- ⚠️ Warning indicator
- 📊 Data/statistics section
- 📁 File/path information
- 📈 Summary/metrics
- 🔍 Troubleshooting/investigation
- 📂 Archive/storage info
- ⏱️ Time-related info (optional, use sparingly)

**Formatting:**
- Use Unicode box-drawing characters for section dividers (━━━)
- Bullet points (•) for list items
- Clear section headings with emojis
- Include full S3 paths for easy copy-paste
- Provide actionable troubleshooting steps in failure notifications
- Keep total message length under 1,000 characters when possible

---

## Monitoring & Metrics

### CloudWatch Metrics

**Custom Metrics:**
- `ReportGenerationSuccess` (Count)
- `ReportGenerationFailure` (Count)
- `DataProcessingDuration` (Milliseconds)
- `ExcelGenerationDuration` (Milliseconds)
- `ReportFileSize` (Bytes)

**Lambda Standard Metrics:**
- Invocations
- Duration
- Errors
- Throttles
- Concurrent Executions

### CloudWatch Alarms

**Critical Alarms:**
1. **Lambda Function Errors**
   - Metric: Errors > 0 in 1 day
   - Action: SNS notification already sent from Lambda
   - Purpose: CloudWatch alarm as backup monitoring

2. **Lambda Timeout**
   - Metric: Duration approaching timeout threshold (>240s)
   - Action: SNS notification to operations team
   - Purpose: Identify performance degradation

3. **Memory Usage**
   - Metric: Memory usage > 80% of allocated memory
   - Action: SNS notification to operations team
   - Purpose: Prevent out-of-memory errors

4. **Report Generation Failure Pattern**
   - Metric: Custom metric `ReportGenerationFailure` > 2 in 1 week
   - Action: SNS notification to operations team
   - Purpose: Identify systemic issues

---

## Deployment Strategy

### Initial Deployment

**✅ AWS SAM (Selected Deployment Method)**
```yaml
# template.yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Description: AWS Service Report Generator - Automated Excel reporting from infrastructure data

Parameters:
  SourceBucketName:
    Type: String
    Default: aws-data-fetcher-output
    Description: S3 bucket containing source data

  NotificationEmail:
    Type: String
    Default: jxman@hotmail.com
    Description: Email address for report notifications
    AllowedPattern: ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$

Resources:
  # SNS Topic for Notifications
  ReportNotificationsTopic:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: aws-service-report-notifications
      DisplayName: AWS Service Report Notifications
      Subscription:
        - Endpoint: !Ref NotificationEmail
          Protocol: email

  # Lambda Function
  ReportGeneratorFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: aws-service-report-generator
      Description: Generates Excel reports from AWS infrastructure data
      Runtime: nodejs20.x
      Handler: index.handler
      MemorySize: 512
      Timeout: 300
      Architectures:
        - arm64
      Environment:
        Variables:
          SOURCE_BUCKET: !Ref SourceBucketName
          SOURCE_KEY: aws-data/complete-data.json
          REPORT_BUCKET: !Ref SourceBucketName
          REPORT_PREFIX: reports/
          ARCHIVE_PREFIX: reports/archive/
          LATEST_REPORT_NAME: aws-service-report-latest.xlsx
          ARCHIVE_RETENTION_DAYS: 7
          SNS_TOPIC_ARN: !Ref ReportNotificationsTopic
      Policies:
        - S3ReadPolicy:
            BucketName: !Ref SourceBucketName
        - S3CrudPolicy:
            BucketName: !Ref SourceBucketName
        - SNSPublishMessagePolicy:
            TopicName: !GetAtt ReportNotificationsTopic.TopicName
      Events:
        S3DataUpdateEvent:
          Type: S3
          Properties:
            Bucket: !Ref SourceBucket
            Events: s3:ObjectCreated:*
            Filter:
              S3Key:
                Rules:
                  - Name: prefix
                    Value: aws-data/
                  - Name: suffix
                    Value: complete-data.json

  # Reference to existing S3 bucket (not created by this template)
  SourceBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Ref SourceBucketName

  # CloudWatch Log Group
  ReportGeneratorLogGroup:
    Type: AWS::Logs::LogGroup
    Properties:
      LogGroupName: !Sub /aws/lambda/${ReportGeneratorFunction}
      RetentionInDays: 30

  # CloudWatch Alarms
  ReportGeneratorErrorAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: aws-service-report-generator-errors
      AlarmDescription: Alert when Lambda function encounters errors
      MetricName: Errors
      Namespace: AWS/Lambda
      Statistic: Sum
      Period: 86400  # 1 day
      EvaluationPeriods: 1
      Threshold: 0
      ComparisonOperator: GreaterThanThreshold
      Dimensions:
        - Name: FunctionName
          Value: !Ref ReportGeneratorFunction
      AlarmActions:
        - !Ref ReportNotificationsTopic

  ReportGeneratorTimeoutAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: aws-service-report-generator-timeout-warning
      AlarmDescription: Alert when Lambda duration approaches timeout
      MetricName: Duration
      Namespace: AWS/Lambda
      Statistic: Maximum
      Period: 3600  # 1 hour
      EvaluationPeriods: 1
      Threshold: 240000  # 240 seconds (4 minutes)
      ComparisonOperator: GreaterThanThreshold
      Dimensions:
        - Name: FunctionName
          Value: !Ref ReportGeneratorFunction
      AlarmActions:
        - !Ref ReportNotificationsTopic

Outputs:
  ReportGeneratorFunctionArn:
    Description: ARN of the report generator Lambda function
    Value: !GetAtt ReportGeneratorFunction.Arn
    Export:
      Name: aws-service-report-generator-arn

  ReportNotificationsTopicArn:
    Description: ARN of the SNS topic for notifications
    Value: !Ref ReportNotificationsTopic
    Export:
      Name: aws-service-report-notifications-topic-arn

  LatestReportS3Path:
    Description: S3 path to the latest report
    Value: !Sub s3://${SourceBucketName}/reports/aws-service-report-latest.xlsx

  ArchiveReportsS3Path:
    Description: S3 path to archived reports
    Value: !Sub s3://${SourceBucketName}/reports/archive/
```

**Alternative Deployment Methods (Not Selected)**

AWS SAM was chosen as the deployment method. These alternatives are documented for reference:

**Terraform:**
- Lambda function resource
- IAM role and policies
- S3 bucket event notification
- SNS topic and subscriptions
- CloudWatch log group and alarms

**AWS CDK:**
- TypeScript/Python constructs
- Infrastructure as code with high-level abstractions
- L2 constructs for Lambda, S3, SNS

**Manual Deployment:**
- Create Lambda function via console
- Package code with dependencies using `npm install` and zip
- Upload zip file to Lambda
- Configure S3 trigger manually
- Not recommended for production

### Deployment Steps (SAM)

**Prerequisites:**
- AWS SAM CLI installed: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html
- AWS CLI configured with appropriate credentials
- Node.js 20.x installed locally for testing

**Initial Deployment:**
```bash
# 1. Validate SAM template
sam validate

# 2. Build the application
sam build

# 3. Deploy with guided prompts (first time only)
sam deploy --guided

# Follow prompts:
#   - Stack Name: aws-service-report-generator
#   - AWS Region: us-east-1 (or your preferred region)
#   - Parameter SourceBucketName: aws-data-fetcher-output
#   - Parameter NotificationEmail: your-email@example.com
#   - Confirm changes before deploy: Y
#   - Allow SAM CLI IAM role creation: Y
#   - ReportGeneratorFunction may not have authorization defined, Is this okay?: Y
#   - Save arguments to configuration file: Y
#   - SAM configuration file: samconfig.toml
#   - SAM configuration environment: default

# 4. Confirm SNS subscription
# Check your email and click the confirmation link

# 5. Test manual invocation
aws lambda invoke \
  --function-name aws-service-report-generator \
  --payload '{}' \
  response.json

# 6. Check execution results
cat response.json

# 7. Verify S3 reports
aws s3 ls s3://aws-data-fetcher-output/reports/
aws s3 ls s3://aws-data-fetcher-output/reports/archive/
```

**Subsequent Deployments:**
```bash
# After code changes, rebuild and deploy
sam build
sam deploy

# No need for --guided flag after initial deployment
```

**Tear Down (Remove all resources):**
```bash
sam delete --stack-name aws-service-report-generator
```

---

## Testing Strategy

### Unit Tests
- JSON parsing and validation
- Data transformation logic
- Excel sheet generation
- Filename generation
- Error handling

### Integration Tests
- S3 read operations (using localstack or test bucket)
- S3 write operations
- Complete end-to-end report generation
- S3 event trigger simulation

### Manual Testing Checklist
**Core Functionality:**
- [ ] Lambda function invokes successfully
- [ ] Reads complete-data.json from S3
- [ ] Parses 38 regions and 395+ services correctly
- [ ] Generates all 4 Excel sheets (Summary, Regions, Services, Coverage)
- [ ] Excel file is well-formatted with styling and filters

**S3 Operations:**
- [ ] Uploads latest report to `reports/aws-service-report-latest.xlsx`
- [ ] Uploads archive report to `reports/archive/aws-service-report-YYYY-MM-DD-HHmmss.xlsx`
- [ ] Archive retention correctly deletes reports older than 7 days
- [ ] Latest report is overwritten on subsequent runs

**Notifications:**
- [ ] SNS success notification sent with emojis and formatting
- [ ] Success notification includes both S3 paths (latest + archive)
- [ ] Success notification includes data summary (regions, services, timing)
- [ ] SNS failure notification sent on errors with troubleshooting steps
- [ ] Warning notifications sent for non-critical issues
- [ ] Email notifications received at jxman@hotmail.com
- [ ] Email formatting displays correctly (emojis, line breaks, paths)
- [ ] SNS subscription confirmed and active

**Triggers:**
- [ ] S3 event trigger works when complete-data.json is updated
- [ ] Manual invocation works via AWS Console
- [ ] Manual invocation works via AWS CLI

**Monitoring:**
- [ ] CloudWatch logs are created with structured logging
- [ ] CloudWatch logs include S3 paths in success messages
- [ ] CloudWatch metrics published (if custom metrics implemented)
- [ ] CloudWatch alarms trigger appropriately

**Error Handling:**
- [ ] Handles missing S3 source file gracefully
- [ ] Handles invalid JSON format gracefully
- [ ] Handles Excel generation failures gracefully
- [ ] Handles S3 upload failures with retry logic
- [ ] Non-critical archive retention failures don't fail report generation
- [ ] All error scenarios send appropriate SNS notifications

---

## Cost Estimation (Initial Phase)

### Assumptions
- **Reports Generated:** 30 per month (daily at 2 AM UTC)
- **Lambda Duration:** 3 seconds average
- **Lambda Memory:** 512 MB
- **Lambda Architecture:** arm64 (20% cost savings vs x86)
- **Data Size:** 400 KB input, 500 KB output per report
- **Archive Retention:** 7 days (7 × 500 KB = 3.5 MB)
- **SNS Notifications:** 60 per month (30 success + 30 email deliveries)

### Monthly Costs (us-east-1 pricing)

**Lambda (arm64):**
- Requests: 30 × $0.20 per 1M = $0.000006
- Compute: 30 × 3s × 512 MB × $0.0000133334 per GB-second = $0.0006
- **Total Lambda:** ~$0.001/month

**S3 Storage:**
- Source data: 400 KB = negligible
- Latest report: 500 KB = negligible
- Archive reports: 7 × 500 KB = 3.5 MB = negligible
- **Total S3 Storage:** < $0.01/month

**S3 API Requests:**
- PUT requests: 60/month (2 per report) × $0.005 per 1,000 = $0.0003
- GET requests: 30/month × $0.0004 per 1,000 = negligible
- DELETE requests: ~4/month (cleanup) = negligible
- LIST requests: 30/month × $0.005 per 1,000 = negligible
- **Total S3 API:** < $0.001/month

**SNS:**
- Publish requests: 30/month × $0.50 per 1M = negligible
- Email deliveries: 30/month × $2.00 per 100,000 = $0.0006
- **Total SNS:** ~$0.001/month

**CloudWatch Logs:**
- Log ingestion: ~1 MB/month = negligible
- Log storage: 1 MB × 30 days = negligible
- **Total CloudWatch Logs:** < $0.01/month

**CloudWatch Alarms:**
- 2 alarms × $0.10 per alarm = $0.20/month
- **Total CloudWatch Alarms:** $0.20/month

**Estimated Total: ~$0.21/month**

**Cost Breakdown:**
- Lambda: < $0.01
- S3: < $0.02
- SNS: < $0.01
- CloudWatch Logs: < $0.01
- CloudWatch Alarms: $0.20
- **Total: ~$0.21/month**

**Cost Optimization Notes:**
- arm64 architecture provides 20% cost savings vs x86_64
- 7-day archive retention keeps storage costs minimal
- CloudWatch Alarms are the primary cost driver (~95% of total)
- Consider removing alarms for cost savings (rely on SNS from Lambda)
- Node.js 20 native performance improvements reduce execution time

---

## Security Considerations

### Data Protection
- ✓ All S3 buckets encrypted at rest (SSE-S3 or KMS)
- ✓ Lambda execution role follows least privilege principle
- ✓ No hardcoded credentials in code
- ✓ VPC deployment not required (public AWS services only)

### Access Control
- ✓ S3 bucket policies restrict public access
- ✓ IAM role scoped to specific S3 paths
- ✓ CloudWatch Logs encrypted
- ✓ Lambda function URL not exposed (if using S3 trigger only)

### Compliance
- ✓ Enable S3 access logging for audit trail
- ✓ CloudTrail logging for Lambda invocations
- ✓ Retain logs per compliance requirements
- ✓ Tag all resources for cost allocation and governance

---

## Future Enhancements (Phase 2+)

### Phase 2: Enhanced Reporting
- [ ] **Multiple Report Formats:** PDF, CSV, HTML
- [ ] **Report Scheduling:** Daily, weekly, monthly options
- [ ] **Email Delivery:** SES integration to send reports via email
- [ ] **Report Comparison:** Delta reports showing changes between periods
- [ ] **Custom Filters:** Generate reports for specific regions or services

### Phase 3: Advanced Analytics
- [ ] **Historical Trending:** Track service availability changes over time
- [ ] **Cost Analysis:** Integrate with AWS Cost Explorer data
- [ ] **Resource Usage:** Include actual resource counts per region
- [ ] **Compliance Reports:** Map services to compliance frameworks

### Phase 4: Web Interface
- [ ] **API Gateway + Frontend:** Web interface to request/download reports
- [ ] **Authentication:** Cognito user pool for access control
- [ ] **Report History:** Browse and download previous reports
- [ ] **Interactive Dashboards:** QuickSight or custom dashboard

### Phase 5: Real-time Processing
- [ ] **DynamoDB:** Store processed data for quick access
- [ ] **API Endpoints:** Query service/region data via REST API
- [ ] **WebSocket Updates:** Real-time notifications for data updates

---

## Design Decisions (Finalized)

All key design decisions have been confirmed:

1. **✅ S3 Trigger Behavior:**
   - **Decision:** S3 event trigger for every data update (daily at ~2 AM UTC)
   - **Rationale:** Data fetcher runs daily, automatic report generation aligns with data refresh

2. **✅ Report Retention:**
   - **Decision:** Latest report in root + 7 days of archives
   - **Rationale:** Quick access to current report, 7-day history for comparison, automated cleanup

3. **✅ Service-by-Region Sheet:**
   - **Decision:** Full matrix (395 services × 38 regions = ~15,000 cells) - acceptable
   - **Rationale:** Modern Excel handles this well, provides valuable service availability overview

4. **✅ Error Notifications:**
   - **Decision:** SNS notifications for both success and failure
   - **Rationale:** Proactive monitoring, immediate awareness of issues

5. **✅ Multi-Region Deployment:**
   - **Decision:** Single region deployment (us-east-1 recommended)
   - **Rationale:** Source data in us-east-1, no multi-region requirements for Phase 1

6. **✅ Node.js Version:**
   - **Decision:** Node.js 20.x
   - **Rationale:** LTS support, Node.js 18 approaching EOL (2025-04-30)

7. **✅ Deployment Method:**
   - **Decision:** AWS SAM
   - **Rationale:** Serverless-native, simpler than Terraform for Lambda-centric projects

---

## Success Criteria

**Phase 1 is complete when:**

**Core Functionality:**
- ✓ Lambda function successfully reads `complete-data.json` from S3
- ✓ Processes 38 regions and 395+ services from AWS infrastructure data
- ✓ Excel file is generated with all 4 sheets (Summary, Regions, Services, Coverage)
- ✓ Excel file is properly formatted with headers, filters, frozen panes, and hyperlinks
- ✓ Service-by-region matrix displays all 15,000+ cells correctly

**S3 Operations:**
- ✓ Latest report uploaded to `reports/aws-service-report-latest.xlsx` (overwritten daily)
- ✓ Archive report uploaded to `reports/archive/aws-service-report-YYYY-MM-DD-HHmmss.xlsx`
- ✓ Archive retention automatically deletes reports older than 7 days
- ✓ Both latest and archive paths work correctly

**Triggers & Execution:**
- ✓ S3 event trigger invokes Lambda when `complete-data.json` is updated (daily at ~2 AM)
- ✓ Manual invocation works via AWS Console
- ✓ Manual invocation works via AWS CLI

**Notifications:**
- ✓ SNS success notification sent with emojis and formatted sections
- ✓ Success notification includes both S3 paths (latest + archive)
- ✓ Success notification includes data summary (38 regions, 395+ services, timing)
- ✓ SNS failure notification sent with troubleshooting steps
- ✓ Warning notifications sent for non-critical issues (archive cleanup)
- ✓ Email notifications received at jxman@hotmail.com
- ✓ Email formatting displays correctly (emojis, Unicode characters, line breaks)
- ✓ Email subscription confirmed and active

**Monitoring & Logging:**
- ✓ CloudWatch logs capture execution details with structured logging
- ✓ CloudWatch alarms configured for errors and timeouts
- ✓ Alarms trigger SNS notifications when thresholds exceeded
- ✓ Log retention set to 30 days

**Error Handling:**
- ✓ Gracefully handles missing S3 source file
- ✓ Gracefully handles invalid JSON format
- ✓ Gracefully handles Excel generation failures
- ✓ Gracefully handles S3 upload failures with retry logic
- ✓ Non-critical archive retention failures don't fail report generation

**Infrastructure:**
- ✓ SAM template validates successfully
- ✓ All AWS resources deployed via SAM (Lambda, SNS, CloudWatch)
- ✓ IAM permissions properly scoped (least privilege)
- ✓ Resources tagged appropriately

**Documentation:**
- ✓ DESIGN.md complete and accurate
- ✓ CLAUDE.md updated with project-specific details
- ✓ README.md created with usage instructions
- ✓ SAM template.yaml fully documented

---

## Next Steps

### Implementation Phase
1. **Setup Project:**
   - Initialize Node.js project with `npm init`
   - Install dependencies: `@aws-sdk/client-s3`, `exceljs`, `date-fns`
   - Create Lambda function handler

2. **Core Development:**
   - Implement S3 data fetching logic
   - Implement JSON parsing and validation
   - Implement Excel generation with 4 sheets
   - Implement S3 upload logic

3. **Testing:**
   - Write unit tests for data processing
   - Test with sample `complete-data.json`
   - Test manual Lambda invocation
   - Verify Excel output quality

4. **Deployment:**
   - Package Lambda function with dependencies
   - Create IAM execution role
   - Deploy Lambda function
   - Configure S3 event trigger (optional)

5. **Validation:**
   - Run end-to-end test
   - Verify report accuracy
   - Check CloudWatch logs
   - Document usage instructions

6. **Handoff:**
   - Update CLAUDE.md with project-specific details
   - Create README.md with usage instructions
   - Document deployment process
   - Create runbook for operations

---

## Appendix

### Technology Stack Summary
- **Language:** Node.js 20.x (LTS)
- **AWS Services:** Lambda, S3, SNS, CloudWatch, IAM
- **Key Libraries:** AWS SDK v3 (S3 + SNS), ExcelJS, date-fns v3
- **Deployment:** AWS SAM (CloudFormation)
- **Architecture:** Serverless, event-driven, notification-based
- **Lambda Architecture:** arm64 (Graviton2)

### Key Files Reference
- **Source Data:** `s3://aws-data-fetcher-output/aws-data/complete-data.json`
- **Latest Report:** `s3://aws-data-fetcher-output/reports/aws-service-report-latest.xlsx`
- **Archive Reports:** `s3://aws-data-fetcher-output/reports/archive/`
- **Data Contract:** https://github.com/jxman/aws-infrastructure-fetcher/blob/main/DATA_CONTRACT.md
- **Data Fetcher Repo:** https://github.com/jxman/aws-infrastructure-fetcher
- **Schema Version:** 1.4.0
- **Data Update Schedule:** Daily at 2 AM UTC (~13 seconds execution)

### Related Documentation
- AWS Lambda Node.js Development: https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html
- ExcelJS Documentation: https://github.com/exceljs/exceljs
- AWS SDK for JavaScript v3: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/
- S3 Event Notifications: https://docs.aws.amazon.com/AmazonS3/latest/userguide/NotificationHowTo.html

---

**Document Version:** 1.3.0
**Author:** AWS Service Reporting Team
**Last Review:** 2025-10-16

**Change Log:**
- v1.3.0 (2025-10-16):
  - **Excel Enhancements:**
    - Summary sheet now uses EST/EDT timestamps for Report Generated and Data Timestamp
    - Regions sheet added Service Count column
    - Regions sheet launch dates formatted as YYYY-MM-DD
    - Services sheet added Available Regions and Coverage % columns with color coding
    - Service Coverage sheet shows red X (✗) for unavailable services
    - N/A values displayed in gray italic for missing data
  - **Data Processing:**
    - Now reads both complete-data.json and services.json
    - Service codes merged with full names for display
    - Added formatDateEST() utility function for timezone conversion
  - **Report Metrics:**
    - Current report size: 65.61 KB
    - Processing time: ~4 seconds
    - Excel generation: ~3.3 seconds
  - Updated documentation with actual implementation details
- v1.2.0 (2025-10-14):
  - Added detailed SNS notification templates (success, failure, warning)
  - Implemented emoji-based notification formatting
  - Specified notification email: jxman@hotmail.com
  - Confirmed deployment region: us-east-1
  - Added full S3 paths in success notifications
  - Created notification design guidelines
  - Enhanced testing checklist for notification verification
- v1.1.0 (2025-10-14):
  - Confirmed Node.js 20.x (v18 approaching EOL)
  - Added SNS notifications for success and failure
  - Implemented latest + 7-day archive retention strategy
  - Updated architecture diagram with SNS integration
  - Finalized SAM as deployment method
  - Added comprehensive CloudWatch alarms
  - Confirmed S3 event trigger + manual invocation
  - Updated cost estimation with SNS and alarms
- v1.0.0 (2025-10-14):
  - Initial design document
