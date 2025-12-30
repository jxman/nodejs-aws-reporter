# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Fixed CloudFormation output key name in GitHub Actions workflow to correctly retrieve Lambda function name for automated testing

## [1.3.1] - 2025-12-30

### Added
- **Automated Lambda Testing**: GitHub Actions workflow now automatically tests deployed Lambda function after each deployment
  - Invokes Lambda function with empty payload to simulate S3 event trigger
  - Validates HTTP 200 response code
  - Displays full JSON response in GitHub Actions summary
  - Provides immediate feedback on deployment success
  - Confirms end-to-end functionality (S3 read, Excel generation, SNS notification)

### Changed
- Upgraded Lambda runtime from Node.js 20.x to Node.js 22.x for improved performance and security
- Enhanced GitHub Actions workflow with comprehensive deployment summaries

### Security
- Fixed dependency vulnerabilities identified by Snyk security scanning
- Added customer-managed KMS encryption for CloudWatch Logs
- Enabled KMS encryption for SNS topic (addresses SNYK-CC-TF-55)
- Fixed inflight dependency vulnerability (SNYK-JS-INFLIGHT-6095116)

## [1.3.0] - 2025-10-16

### Added
- **EST/EDT Timestamp Support**: Summary sheet now displays timestamps in Eastern Time
  - Report Generated timestamp in EST/EDT format
  - Data Timestamp converted to EST/EDT
  - Automatic daylight saving time detection
- **Enhanced Regions Sheet**:
  - Service Count column showing number of services per region
  - Formatted Launch Dates in YYYY-MM-DD format
  - N/A values for missing data displayed in gray italic
- **Enhanced Services Sheet**:
  - Available Regions column showing regional availability count
  - Coverage % column with color-coded percentages:
    - 100%: Green bold (fully available)
    - 75-99%: Light green
    - 50-74%: Orange
    - 1-49%: Red
    - 0%: Gray italic
- **Enhanced Service Coverage Sheet**:
  - Red ✗ for services not available in a region
  - Improved visual distinction between available/unavailable services
- **Dual Source Data Reading**:
  - Now reads both complete-data.json (regions, mappings) and services.json (full service names)
  - Merges service codes with full AWS service names for better reporting

### Changed
- Improved date formatting consistency across all sheets
- Enhanced data normalization to handle nested structures and multiple field name patterns
- Updated Excel generation to use date-fns for consistent date handling

## [1.2.0] - 2025-10-01

### Added
- **Comprehensive AWS Resource Tagging**: All resources now follow standardized 10-tag requirement
  - Environment, ManagedBy, Owner, Project, Service, GithubRepo
  - Site, BaseProject, Name, SubService
  - Applied to Lambda, SNS, CloudWatch Logs, CloudWatch Alarms, KMS Key
- **IAM Policy Synchronization Pattern**: Documented mandatory process for keeping live IAM policy and setup script in sync
- **CloudWatch Tagging Permissions**: Added required permissions to list CloudWatch tags

### Changed
- Enhanced setup-oidc.sh script with KMS permissions for SNS encryption
- Broadened IAM role pattern to support CloudFormation-generated role naming conventions

### Fixed
- Updated test script to gracefully handle projects without tests (continues instead of failing)
- Added SAM CLI managed stack to OIDC CloudFormation permissions for deployment support

## [1.1.0] - 2025-09-15

### Added
- **GitHub Actions CI/CD**: Automated deployment pipeline with OIDC authentication
  - Test and validation job (linting, tests, SAM validation)
  - Deployment job (builds and deploys to AWS)
  - Triggered on push to main, pull requests, and manual dispatch
- **OIDC Security Implementation**: Project-specific IAM resources with repository isolation
  - IAM Role: GithubActionsOIDC-AWSServicesReporter-Role
  - IAM Policy: GithubActions-AWSServicesReporter-Policy
  - Complete repository isolation in trust policy
- **Public Distribution**: Automatic copying to www.aws-services.synepho.com
  - S3 CopyObject with custom cache-control headers (5-minute cache)
  - Non-critical operation (failures logged but don't stop report generation)

### Changed
- **Deployment Policy**: GitHub Actions is now the mandatory deployment method
  - Local sam deploy deprecated and archived
  - All deployments must go through CI/CD for audit trail and security
- Enhanced documentation with deployment workflows and troubleshooting

### Security
- Removed long-lived AWS credentials in favor of OIDC web identity federation
- Implemented least-privilege IAM permissions scoped to project resources
- Added repository-specific trust policy preventing cross-project access

## [1.0.0] - 2025-08-01

### Added
- Initial release of AWS Service Report Generator
- Automated Excel report generation from AWS infrastructure data
- 4-sheet Excel workbook:
  - Summary (metadata and statistics)
  - Regions (38 AWS regions with details)
  - Services (395 AWS services alphabetically sorted)
  - Service Coverage (matrix of service availability by region)
- S3 event trigger integration for automated daily reports
- Smart retention management (latest + 7-day archive with automatic cleanup)
- Email notifications via SNS (success, failure, warning)
- Production-ready error handling and CloudWatch monitoring
- CloudWatch alarms for errors and timeout warnings

### Infrastructure
- AWS Lambda function (Node.js 20.x, ARM64 Graviton2)
- SAM/CloudFormation template for infrastructure as code
- S3 integration for source data and report storage
- SNS topic for email notifications
- CloudWatch Logs with 30-day retention
- CloudWatch Alarms for monitoring

### Documentation
- Comprehensive README with architecture diagrams
- DESIGN.md with complete specification
- CLAUDE.md for AI-assisted development
- Detailed deployment and troubleshooting guides

[Unreleased]: https://github.com/jxman/nodejs-aws-reporter/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/jxman/nodejs-aws-reporter/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/jxman/nodejs-aws-reporter/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/jxman/nodejs-aws-reporter/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/jxman/nodejs-aws-reporter/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/jxman/nodejs-aws-reporter/releases/tag/v1.0.0
