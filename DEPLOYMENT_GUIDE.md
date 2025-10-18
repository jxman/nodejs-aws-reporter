# Deployment Guide - AWS Service Report Generator

Complete guide for deploying and managing the AWS Service Report Generator using GitHub Actions with OIDC authentication.

## Table of Contents

1. [Deployment Policy](#deployment-policy)
2. [Architecture Overview](#architecture-overview)
3. [Prerequisites](#prerequisites)
4. [Initial Setup](#initial-setup)
5. [GitHub Actions Workflow](#github-actions-workflow)
6. [Deployment Operations](#deployment-operations)
7. [Post-Deployment Configuration](#post-deployment-configuration)
8. [Monitoring Deployments](#monitoring-deployments)
9. [Troubleshooting](#troubleshooting)
10. [Security Best Practices](#security-best-practices)

---

## Deployment Policy

### GitHub Actions Only - Mandatory

**CRITICAL: All infrastructure deployments MUST use GitHub Actions workflows. Local deployment is strictly for testing purposes only.**

#### Why GitHub Actions is Mandatory

- **Security**: Uses OIDC authentication instead of long-lived AWS credentials
- **Audit Trail**: Complete deployment history in GitHub Actions logs
- **Consistency**: Standardized deployment environment across all deployments
- **Team Visibility**: All deployments tracked and visible to the team
- **Best Practices**: Infrastructure deployed through CI/CD, never from local machines
- **Compliance**: Supports enterprise security and compliance requirements

#### What's Deprecated

- ❌ **Local `sam deploy`**: Moved to testing only
- ❌ **Manual AWS Console deployments**: Not recommended
- ❌ **Long-lived AWS credentials**: Replaced with OIDC

---

## Architecture Overview

### Deployment Architecture

```
┌─────────────────────┐
│   Developer         │
│   Local Machine     │
└──────────┬──────────┘
           │
           │ (1) git push origin main
           │
           ▼
┌─────────────────────┐
│  GitHub Repository  │
│  aws-services-      │
│   reporter          │
└──────────┬──────────┘
           │
           │ (2) Triggers GitHub Actions Workflow
           │
           ▼
┌─────────────────────┐
│  GitHub Actions     │
│  Runner             │
│  - Lint & Test      │
│  - Validate SAM     │
│  - Build & Deploy   │
└──────────┬──────────┘
           │
           │ (3) OIDC Authentication
           │     (No AWS credentials stored)
           │
           ▼
┌─────────────────────┐
│  AWS Account        │
│  - Assume OIDC Role │
│  - SAM/CFN Deploy   │
│  - Lambda Function  │
│  - S3, SNS, CW      │
└─────────────────────┘
```

### OIDC Authentication Flow

1. GitHub Actions runner requests OIDC token from GitHub
2. GitHub issues signed JWT token with repository information
3. Runner assumes AWS IAM role using `AssumeRoleWithWebIdentity`
4. AWS validates token against OIDC provider trust policy
5. AWS grants temporary credentials (valid for duration of job)
6. Runner deploys infrastructure using temporary credentials

**Security Benefits:**
- No AWS credentials stored in GitHub
- Temporary credentials expire after job completion
- Repository-specific trust policy prevents cross-repo access
- Full audit trail in AWS CloudTrail

---

## Prerequisites

### Required Tools

- **GitHub Account**: Access to repository `jxman/aws-services-reporter`
- **GitHub CLI** (optional): For manual workflow triggers
  ```bash
  # Install GitHub CLI
  brew install gh  # macOS
  # OR download from https://cli.github.com/

  # Authenticate
  gh auth login
  ```

- **AWS CLI** (optional): For post-deployment configuration
  ```bash
  # Install AWS CLI v2
  # macOS: brew install awscli
  # OR download from https://aws.amazon.com/cli/

  # Verify installation
  aws --version
  ```

### AWS Resources (Pre-deployed)

- **S3 Bucket**: `aws-data-fetcher-output` (must exist before deployment)
- **OIDC IAM Resources**: Deployed via Terraform (see `archived/terraform/github-oidc/`)
  - OIDC Provider: `token.actions.githubusercontent.com`
  - IAM Role: `GithubActionsOIDC-AWSServicesReporter-Role`
  - IAM Policy: `GithubActions-AWSServicesReporter-Policy`

### Verify OIDC Infrastructure

Check if OIDC resources are deployed:

```bash
# Check OIDC provider
aws iam list-open-id-connect-providers | grep github

# Check IAM role
aws iam get-role --role-name GithubActionsOIDC-AWSServicesReporter-Role

# Check IAM policy
aws iam get-policy --policy-arn arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):policy/GithubActions-AWSServicesReporter-Policy
```

---

## Initial Setup

### Step 1: Clone Repository

```bash
git clone https://github.com/jxman/aws-services-reporter.git
cd aws-services-reporter
```

### Step 2: Configure GitHub Secret

Add the OIDC IAM role ARN as a GitHub secret:

```bash
# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Set GitHub secret
gh secret set AWS_ROLE_ARN \
  --body "arn:aws:iam::${ACCOUNT_ID}:role/GithubActionsOIDC-AWSServicesReporter-Role"

# Verify secret is set
gh secret list
```

**Manual Method** (if GitHub CLI not available):
1. Go to GitHub repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `AWS_ROLE_ARN`
4. Value: `arn:aws:iam::ACCOUNT_ID:role/GithubActionsOIDC-AWSServicesReporter-Role`
5. Click "Add secret"

### Step 3: Verify S3 Bucket Exists

```bash
# Check if source bucket exists
aws s3 ls s3://aws-data-fetcher-output/

# Verify source data file exists
aws s3 ls s3://aws-data-fetcher-output/aws-data/complete-data.json
```

If bucket doesn't exist, create it:
```bash
aws s3 mb s3://aws-data-fetcher-output --region us-east-1
```

### Step 4: Initial Deployment

Trigger the first deployment by pushing to main branch:

```bash
# Make a small change or create a deployment marker
git commit --allow-empty -m "Initial deployment trigger"
git push origin main

# Monitor deployment
gh run list --limit 1
gh run watch  # Watch in real-time
```

---

## GitHub Actions Workflow

### Workflow File Location

`.github/workflows/deploy.yml`

### Workflow Triggers

The workflow runs on:
1. **Push to main branch** → Automatically deploys
2. **Pull requests to main** → Tests and validates (no deployment)
3. **Manual trigger** → Via GitHub UI or `gh workflow run`

### Workflow Jobs

#### Job 1: test-and-validate (runs on all triggers)

```yaml
steps:
  - Checkout code
  - Setup Node.js 18
  - Install dependencies (npm ci)
  - Run linting (npm run lint)
  - Run tests (npm test)
  - Setup AWS SAM CLI
  - Validate SAM template
  - Build SAM application
```

**Purpose**: Ensure code quality and infrastructure validity before deployment

#### Job 2: deploy (runs only on push to main)

```yaml
steps:
  - Checkout code
  - Setup Node.js 18
  - Install dependencies
  - Setup AWS SAM CLI
  - Configure AWS Credentials (OIDC)
  - Build SAM application
  - Deploy SAM application
  - Get Stack Outputs
  - Display Deployment Summary
```

**Purpose**: Deploy infrastructure to AWS using temporary OIDC credentials

### OIDC Authentication Step

```yaml
- name: Configure AWS Credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
    aws-region: us-east-1
    role-session-name: GitHubActionsOIDCSession
```

This step:
1. Requests OIDC token from GitHub
2. Assumes IAM role without stored credentials
3. Receives temporary AWS credentials
4. Credentials valid for duration of job only

---

## Deployment Operations

### Standard Deployment (Push to Main)

```bash
# 1. Make code changes
vim src/index.js

# 2. Test locally (optional)
cd src
npm install
npm run lint
npm test
cd ..

sam validate --lint
sam build

# 3. Commit and push
git add .
git commit -m "Description of changes"
git push origin main

# 4. Monitor deployment
gh run list --limit 5
gh run view --web  # Opens in browser
```

### Manual Deployment Trigger

Manually trigger the workflow without pushing code:

```bash
# Via GitHub CLI
gh workflow run "Deploy SAM Application" --ref main

# Monitor
gh run watch
```

**Manual Trigger via GitHub UI:**
1. Go to repository → Actions tab
2. Select "Deploy SAM Application" workflow
3. Click "Run workflow" dropdown
4. Select branch: `main`
5. Click "Run workflow" button

### Emergency Rollback

If a deployment fails or causes issues:

```bash
# 1. Revert the commit locally
git revert HEAD
git push origin main

# 2. OR redeploy previous working version
git checkout <previous-commit-hash>
git push origin main --force  # Use with caution

# 3. OR manually update via AWS Console
aws cloudformation update-stack --stack-name aws-service-report-generator \
  --use-previous-template \
  --capabilities CAPABILITY_IAM
```

---

## Post-Deployment Configuration

### Step 1: Confirm SNS Subscription

After first deployment, check email and confirm SNS subscription:

1. Check email inbox for "AWS Notification - Subscription Confirmation"
2. Click "Confirm subscription" link
3. Verify confirmation page appears

**Verify Subscription:**
```bash
aws sns list-subscriptions-by-topic \
  --topic-arn $(aws cloudformation describe-stacks \
    --stack-name aws-service-report-generator \
    --query 'Stacks[0].Outputs[?OutputKey==`ReportNotificationsTopicArn`].OutputValue' \
    --output text)
```

### Step 2: Configure S3 Event Trigger (One-Time)

**CRITICAL**: This enables automatic daily report generation.

```bash
# Get configuration command from stack outputs
CONFIG_CMD=$(aws cloudformation describe-stacks \
  --stack-name aws-service-report-generator \
  --query 'Stacks[0].Outputs[?OutputKey==`S3EventConfigurationCommand`].OutputValue' \
  --output text)

# Execute the configuration command
eval "$CONFIG_CMD"

# Verify S3 event notification is configured
aws s3api get-bucket-notification-configuration \
  --bucket aws-data-fetcher-output
```

**Expected Output:**
```json
{
  "LambdaFunctionConfigurations": [
    {
      "Id": "InvokeReportGenerator",
      "LambdaFunctionArn": "arn:aws:lambda:us-east-1:...:function:aws-service-report-generator",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            {"Name": "prefix", "Value": "aws-data/"},
            {"Name": "suffix", "Value": "complete-data.json"}
          ]
        }
      }
    }
  ]
}
```

### Step 3: Test Manual Invocation

```bash
# Invoke Lambda function manually
aws lambda invoke \
  --function-name aws-service-report-generator \
  --payload '{}' \
  response.json

# Check response
cat response.json

# Verify reports in S3
aws s3 ls s3://aws-data-fetcher-output/reports/
aws s3 ls s3://aws-data-fetcher-output/reports/archive/
```

### Step 4: Verify Distribution (Currently Enabled)

Public distribution is currently enabled and active:

```bash
# Verify distribution configuration
aws lambda get-function-configuration \
  --function-name aws-service-report-generator \
  --query 'Environment.Variables.{DISTRIBUTION_BUCKET: DISTRIBUTION_BUCKET, DISTRIBUTION_KEY: DISTRIBUTION_KEY}' \
  --output json

# Check the distributed file
aws s3api head-object \
  --bucket www.aws-services.synepho.com \
  --key reports/aws-service-report-latest.xlsx \
  --query '{LastModified: LastModified, Size: ContentLength, CacheControl: CacheControl}'
```

**Current Configuration:**
- Distribution Bucket: `www.aws-services.synepho.com` ✅
- Distribution Key: `reports/aws-service-report-latest.xlsx` ✅
- Cache-Control: `public, max-age=300` (5 minutes) ✅
- Status: Active and automatically updating daily

**To disable distribution (if needed):**
```bash
aws cloudformation update-stack \
  --stack-name aws-service-report-generator \
  --use-previous-template \
  --parameters \
    ParameterKey=SourceBucketName,UsePreviousValue=true \
    ParameterKey=NotificationEmail,UsePreviousValue=true \
    ParameterKey=DistributionBucketName,ParameterValue='' \
    ParameterKey=DistributionKeyPath,UsePreviousValue=true \
  --capabilities CAPABILITY_IAM
```

---

## Monitoring Deployments

### GitHub Actions Dashboard

```bash
# List recent workflow runs
gh run list --limit 10

# View specific run
gh run view <RUN_ID>

# View run logs in browser
gh run view <RUN_ID> --web

# Watch deployment in real-time
gh run watch

# Download run logs
gh run download <RUN_ID>
```

### CloudFormation Stack Status

```bash
# Check stack status
aws cloudformation describe-stacks \
  --stack-name aws-service-report-generator \
  --query 'Stacks[0].StackStatus'

# View stack events (recent changes)
aws cloudformation describe-stack-events \
  --stack-name aws-service-report-generator \
  --max-items 20

# View stack outputs
aws cloudformation describe-stacks \
  --stack-name aws-service-report-generator \
  --query 'Stacks[0].Outputs'
```

### Lambda Function Monitoring

```bash
# View recent invocations
aws logs tail /aws/lambda/aws-service-report-generator --since 24h

# Follow logs in real-time
aws logs tail /aws/lambda/aws-service-report-generator --follow

# Check CloudWatch metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=aws-service-report-generator \
  --start-time $(date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum
```

---

## Troubleshooting

### Deployment Failures

#### Issue: GitHub Actions workflow fails with "Role not found"

**Symptom:**
```
Error: User: arn:aws:sts::...:assumed-role/github-actions/... is not authorized to perform: sts:AssumeRole
```

**Solution:**
1. Verify OIDC IAM role exists:
   ```bash
   aws iam get-role --role-name GithubActionsOIDC-AWSServicesReporter-Role
   ```

2. Verify GitHub secret is set correctly:
   ```bash
   gh secret list
   ```

3. Check role trust policy allows this repository:
   ```bash
   aws iam get-role --role-name GithubActionsOIDC-AWSServicesReporter-Role \
     --query 'Role.AssumeRolePolicyDocument'
   ```

   Should include:
   ```json
   "StringLike": {
     "token.actions.githubusercontent.com:sub": "repo:jxman/aws-services-reporter:*"
   }
   ```

#### Issue: SAM deployment fails with "Insufficient permissions"

**Symptom:**
```
Error: User is not authorized to perform: cloudformation:CreateStack
```

**Solution:**
1. Verify IAM policy is attached to role:
   ```bash
   aws iam list-attached-role-policies \
     --role-name GithubActionsOIDC-AWSServicesReporter-Role
   ```

2. Check policy permissions include CloudFormation:
   ```bash
   # Get policy ARN
   POLICY_ARN=$(aws iam list-attached-role-policies \
     --role-name GithubActionsOIDC-AWSServicesReporter-Role \
     --query 'AttachedPolicies[0].PolicyArn' --output text)

   # Get policy version
   VERSION=$(aws iam get-policy --policy-arn $POLICY_ARN \
     --query 'Policy.DefaultVersionId' --output text)

   # View policy document
   aws iam get-policy-version --policy-arn $POLICY_ARN --version-id $VERSION
   ```

#### Issue: S3 event notification not triggering Lambda

**Symptom:** Reports are not generated automatically at 2 AM UTC

**Solution:**
1. Verify S3 event notification is configured (see Post-Deployment Step 2)
2. Check Lambda has permission to be invoked by S3:
   ```bash
   aws lambda get-policy --function-name aws-service-report-generator
   ```

3. Test manual invocation to verify function works:
   ```bash
   aws lambda invoke --function-name aws-service-report-generator \
     --payload '{}' response.json
   ```

### Common Workflow Issues

#### Issue: npm install fails in workflow

**Solution:**
```bash
# Ensure package-lock.json is committed
git add src/package-lock.json
git commit -m "Add package-lock.json for GitHub Actions cache"
git push origin main
```

#### Issue: Lint errors in workflow

**Solution:**
```bash
# Run linting locally and fix errors
cd src
npm run lint

# If errors, fix them manually or use auto-fix
npm run lint:fix  # If configured

# Commit fixes
git add .
git commit -m "Fix linting errors"
git push origin main
```

---

## Security Best Practices

### OIDC Configuration

✅ **DO:**
- Keep OIDC thumbprints up to date (check GitHub documentation)
- Restrict trust policy to specific repository
- Use least privilege IAM permissions
- Rotate IAM policies when AWS APIs change

❌ **DON'T:**
- Share OIDC roles across multiple projects
- Use wildcard trust policies (`repo:*/*:*`)
- Grant broad IAM permissions (`*:*`)
- Store AWS credentials in GitHub secrets

### GitHub Secrets Management

✅ **DO:**
- Use organization-level secrets for shared resources
- Regularly audit secret usage
- Delete unused secrets
- Document what each secret is for

❌ **DON'T:**
- Store long-lived AWS credentials
- Share secrets across unrelated repositories
- Hard-code secrets in workflow files

### Deployment Security

✅ **DO:**
- Review pull requests before merging to main
- Enable branch protection rules
- Require status checks before merge
- Use signed commits (optional)

❌ **DON'T:**
- Push directly to main without PR
- Disable required checks
- Force push to main
- Deploy from feature branches

### Audit and Compliance

**CloudTrail Logging:**
```bash
# View recent AssumeRole events from GitHub
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity \
  --max-results 10
```

**GitHub Actions Audit:**
- All deployments logged in GitHub Actions history
- Download logs for compliance archiving
- Retention: 90 days (GitHub default)

---

## Additional Resources

### Documentation
- [AWS SAM CLI Reference](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-command-reference.html)
- [GitHub Actions - OIDC with AWS](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [Project README](./README.md)
- [Project Design Document](./DESIGN.md)
- [Claude Development Guide](./CLAUDE.md)

### Related Projects
- [aws-infrastructure-fetcher](https://github.com/jxman/aws-infrastructure-fetcher) - Data source for this project

### Support
- GitHub Issues: [Report issues](https://github.com/jxman/aws-services-reporter/issues)
- Documentation: See `README.md`, `DESIGN.md`, and `CLAUDE.md`

---

**Last Updated:** 2025-10-17
**Version:** 1.0.0
**Maintained By:** jxman
