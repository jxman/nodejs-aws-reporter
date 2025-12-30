# Deployment Guide

This guide explains how to deploy the AWS Services Reporter using GitHub Actions with OIDC authentication.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [GitHub Actions Workflow](#github-actions-workflow)
- [Manual Deployment](#manual-deployment)
- [Troubleshooting](#troubleshooting)
- [Security Best Practices](#security-best-practices)

## Overview

This project uses GitHub Actions for automated deployments with the following features:

- **OIDC Authentication**: Secure authentication without long-lived AWS credentials
- **Automated Testing**: Linting and validation on every push/PR
- **Continuous Deployment**: Automatic deployment to AWS on push to main branch
- **Manual Triggers**: Deploy on-demand using workflow_dispatch
- **Project-Specific IAM**: Isolated IAM resources for security

## Prerequisites

Before setting up the deployment pipeline, ensure you have:

1. **AWS Account** with administrative access
2. **AWS CLI** installed and configured locally
3. **jq** (JSON processor) installed
4. **GitHub Repository** for this project
5. **Node.js** (>= 22.0.0) installed locally

### Required Tools

```bash
# Check AWS CLI
aws --version

# Check jq
jq --version

# Check Node.js
node --version
```

### Install jq (if needed)

```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq

# Amazon Linux/RHEL/CentOS
sudo yum install jq
```

## Initial Setup

### Step 1: Configure OIDC Infrastructure

The OIDC infrastructure must be deployed once before GitHub Actions can deploy your SAM application.

#### 1.1 Run the OIDC Setup Script

The project includes a bash script that creates all necessary OIDC resources.

```bash
# Run the setup script
./scripts/setup-oidc.sh
```

The script will:
1. Check prerequisites (AWS CLI, jq)
2. Prompt for your GitHub repository (format: `owner/repo`)
3. Auto-detect your AWS account ID and region
4. Create OIDC provider (if it doesn't exist)
5. Create IAM role with trust policy restricted to your repository
6. Create IAM policy with required permissions
7. Attach policy to role
8. Display the role ARN

#### 1.2 Example Output

```
╔════════════════════════════════════════════════════════════╗
║  GitHub Actions OIDC Setup for AWS Services Reporter      ║
╚════════════════════════════════════════════════════════════╝

========================================
Checking Prerequisites
========================================

✓ AWS CLI found: aws-cli/2.x.x
✓ jq found: jq-1.x
✓ AWS credentials configured

========================================
Configuration
========================================

ℹ AWS Account ID: 123456789012
ℹ AWS Region: us-east-1
GitHub Repository (format: owner/repo): your-username/aws-services-reporter
ℹ GitHub Repository: your-username/aws-services-reporter

⚠ About to create the following resources:
  - OIDC Provider: token.actions.githubusercontent.com
  - IAM Role: GithubActionsOIDC-AWSServicesReporter-Role
  - IAM Policy: GithubActions-AWSServicesReporter-Policy
  - For Repository: your-username/aws-services-reporter

Continue? (yes/no): yes

========================================
Creating OIDC Provider
========================================

✓ OIDC Provider created: arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com

========================================
Creating IAM Policy
========================================

✓ IAM Policy created: arn:aws:iam::123456789012:policy/GithubActions-AWSServicesReporter-Policy

========================================
Creating IAM Role
========================================

✓ IAM Role created: arn:aws:iam::123456789012:role/GithubActionsOIDC-AWSServicesReporter-Role

========================================
Attaching Policy to Role
========================================

✓ Policy attached to role

========================================
Setup Complete!
========================================

✓ OIDC Provider created/verified
✓ IAM Role created/verified
✓ IAM Policy created/verified
✓ Policy attached to role

========================================
Next Steps
========================================

1. Add the following secret to your GitHub repository:

   Secret Name:  AWS_ROLE_ARN
   Secret Value: arn:aws:iam::123456789012:role/GithubActionsOIDC-AWSServicesReporter-Role

2. Navigate to your repository settings:
   https://github.com/your-username/aws-services-reporter/settings/secrets/actions

3. Click 'New repository secret' and add the above values

4. Push your code to trigger the GitHub Actions workflow

ℹ Role ARN saved to: oidc-role-arn.txt
```

#### 1.3 Re-running the Script

The script is idempotent - you can safely run it multiple times. It will:
- Skip creating resources that already exist
- Update the trust policy if your repository changed
- Display the existing role ARN

#### 1.4 Cleanup (Optional)

If you need to remove the OIDC resources:

```bash
./scripts/cleanup-oidc.sh
```

The cleanup script will prompt you to confirm deletion and optionally remove the OIDC provider (which can be shared across projects).

### Step 2: Configure GitHub Repository

#### 2.1 Add AWS Role ARN as Secret

1. Navigate to your GitHub repository
2. Go to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add the following secret:
   - **Name**: `AWS_ROLE_ARN`
   - **Value**: `arn:aws:iam::ACCOUNT_ID:role/GithubActionsOIDC-AWSServicesReporter-Role`

#### 2.2 Verify Workflow File

The workflow file should already exist at `.github/workflows/deploy.yml`. Verify it's present:

```bash
cat .github/workflows/deploy.yml
```

### Step 3: Install Dependencies Locally

```bash
cd src
npm install
```

### Step 4: Initial SAM Deployment (Optional)

If you want to test locally before using GitHub Actions:

```bash
# Validate template
sam validate --lint

# Build application
sam build

# Deploy (with guided prompts for first time)
sam deploy --guided
```

**Note**: After OIDC setup, all deployments should use GitHub Actions.

## GitHub Actions Workflow

### Workflow Triggers

The deployment workflow triggers on:

1. **Push to main branch**: Runs tests and deploys automatically
2. **Pull requests**: Runs tests only (no deployment)
3. **Manual trigger**: Use workflow_dispatch for on-demand deployments

### Workflow Jobs

#### Job 1: Test and Validate

Runs on all triggers (push, PR, manual):

1. Checkout code
2. Setup Node.js 22
3. Install dependencies
4. Run ESLint linting
5. Run tests (if available)
6. Setup AWS SAM CLI
7. Validate SAM template
8. Build SAM application

#### Job 2: Deploy

Runs only on push to main:

1. Checkout code
2. Setup Node.js and Python
3. Install dependencies
4. Configure AWS credentials via OIDC
5. Build SAM application
6. Deploy to AWS
7. Display deployment summary

### Manual Deployment

To trigger a manual deployment:

1. Go to your GitHub repository
2. Click **Actions** tab
3. Select **Deploy SAM Application** workflow
4. Click **Run workflow**
5. Select branch (usually `main`)
6. Click **Run workflow** button

### Monitoring Deployments

#### View Workflow Runs

```bash
# List recent workflow runs
gh run list --limit 10

# View specific run details
gh run view RUN_ID

# View run in browser
gh run view RUN_ID --web

# Watch run in real-time
gh run watch
```

#### View Logs

```bash
# View workflow logs
gh run view RUN_ID --log

# View specific job logs
gh run view RUN_ID --log --job test-and-validate
gh run view RUN_ID --log --job deploy
```

## Manual Deployment

If you need to deploy manually (not recommended for production):

```bash
# Build the application
sam build

# Deploy with parameters
sam deploy \
  --stack-name aws-service-report-generator \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --region us-east-1
```

## Troubleshooting

### Common Issues

#### 1. "User is not authorized to perform: sts:AssumeRoleWithWebIdentity"

**Cause**: GitHub repository doesn't match the trust policy in IAM role.

**Solution**: Verify the trust policy in the IAM role:

```bash
# Check trust policy
aws iam get-role --role-name GithubActionsOIDC-AWSServicesReporter-Role \
  --query 'Role.AssumeRolePolicyDocument' \
  --output json
```

If the repository name is incorrect, re-run the setup script with the correct repository:

```bash
./scripts/setup-oidc.sh
```

The script will update the trust policy for the existing role.

#### 2. ESLint Errors in CI

**Cause**: Code doesn't meet linting standards.

**Solution**: Run linting locally and fix issues:

```bash
cd src
npm run lint

# Auto-fix issues
npm run lint:fix
```

#### 3. SAM Build Fails

**Cause**: Dependencies not properly installed or template issues.

**Solution**:

```bash
# Validate template
sam validate --lint

# Check for errors in template.yaml

# Ensure dependencies are installed
cd src && npm install
```

#### 4. Deployment Timeout

**Cause**: Lambda function exceeds timeout during deployment.

**Solution**: Check CloudFormation stack status:

```bash
aws cloudformation describe-stacks \
  --stack-name aws-service-report-generator \
  --query 'Stacks[0].StackStatus'
```

#### 5. S3 Event Notification Configuration

**Cause**: S3 bucket notification not configured after deployment.

**Solution**: Get and run the configuration command:

```bash
aws cloudformation describe-stacks \
  --stack-name aws-service-report-generator \
  --query 'Stacks[0].Outputs[?OutputKey==`S3EventConfigurationCommand`].OutputValue' \
  --output text | bash
```

## Security Best Practices

### 1. OIDC vs. Long-Lived Credentials

This project uses OIDC authentication, which is more secure than long-lived AWS access keys:

- No credentials stored in GitHub secrets
- Automatic credential rotation
- Scoped to specific repository
- Audit trail in AWS CloudTrail

### 2. Principle of Least Privilege

The IAM policy grants only required permissions:

- CloudFormation operations for SAM
- Lambda function management
- S3 access for specific buckets
- SNS publishing for notifications

### 3. Repository Isolation

The IAM role trust policy restricts access to a single repository:

```json
{
  "StringLike": {
    "token.actions.githubusercontent.com:sub": "repo:username/aws-services-reporter:*"
  }
}
```

### 4. Regular Updates

Keep dependencies and tools updated:

```bash
# Update Node.js dependencies
cd src
npm update

# Update AWS CLI
# macOS: brew upgrade awscli
# Linux: pip install --upgrade awscli

# Update GitHub OIDC thumbprints if needed
# Check official GitHub documentation for latest thumbprints
```

### 5. Secret Management

Never commit sensitive data:

- AWS credentials never stored in code or repository
- Use GitHub secrets for sensitive values (like AWS_ROLE_ARN)
- The `oidc-role-arn.txt` file is gitignored
- Never commit IAM role ARNs or AWS account IDs to public repositories

## Workflow Status Badge

Add this badge to your README.md to show deployment status:

```markdown
![Deploy SAM Application](https://github.com/your-username/aws-services-reporter/actions/workflows/deploy.yml/badge.svg)
```

## Additional Resources

- [AWS SAM Documentation](https://docs.aws.amazon.com/serverless-application-model/)
- [GitHub Actions OIDC with AWS](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [AWS IAM OIDC Identity Providers](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html)
- [ESLint Documentation](https://eslint.org/docs/latest/)
- [GitHub Official OIDC Thumbprints](https://github.blog/changelog/2023-06-27-github-actions-update-on-oidc-integration-with-aws/)

## Support

For issues or questions:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review GitHub Actions workflow logs
3. Check CloudWatch logs for Lambda function errors
4. Open an issue in the repository
