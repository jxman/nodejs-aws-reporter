#!/bin/bash

#############################################################################
# GitHub Actions OIDC Setup Script for AWS Services Reporter
#
# This script creates the necessary AWS IAM resources for GitHub Actions
# to deploy the SAM application using OIDC authentication.
#
# Resources created:
# - OIDC Provider for GitHub Actions
# - IAM Role for GitHub Actions
# - IAM Policy with required permissions
#
# Usage: ./scripts/setup-oidc.sh
#############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project-specific names
PROJECT_NAME="AWSServicesReporter"
ROLE_NAME="GithubActionsOIDC-${PROJECT_NAME}-Role"
POLICY_NAME="GithubActions-${PROJECT_NAME}-Policy"
OIDC_PROVIDER_URL="token.actions.githubusercontent.com"

# GitHub OIDC thumbprints (official from GitHub)
# Source: https://github.blog/changelog/2023-06-27-github-actions-update-on-oidc-integration-with-aws/
THUMBPRINT_1="6938fd4d98bab03faadb97b34396831e3780aea1"
THUMBPRINT_2="1c58a3a8518e8759bf075b76b750d4f2df264fcd"

#############################################################################
# Helper Functions
#############################################################################

print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

#############################################################################
# Prerequisites Check
#############################################################################

check_prerequisites() {
    print_header "Checking Prerequisites"

    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed. Please install it first."
        exit 1
    fi
    print_success "AWS CLI found: $(aws --version)"

    # Check jq (for JSON parsing)
    if ! command -v jq &> /dev/null; then
        print_error "jq is not installed. Please install it first."
        echo "  macOS: brew install jq"
        echo "  Linux: sudo apt-get install jq"
        exit 1
    fi
    print_success "jq found: $(jq --version)"

    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials not configured or invalid."
        exit 1
    fi
    print_success "AWS credentials configured"
}

#############################################################################
# Get User Inputs
#############################################################################

get_inputs() {
    print_header "Configuration"

    # Get AWS Account ID
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    print_info "AWS Account ID: $AWS_ACCOUNT_ID"

    # Get AWS Region
    AWS_REGION=$(aws configure get region || echo "us-east-1")
    read -p "AWS Region [$AWS_REGION]: " INPUT_REGION
    AWS_REGION=${INPUT_REGION:-$AWS_REGION}
    print_info "AWS Region: $AWS_REGION"

    # Get GitHub Repository
    echo ""
    read -p "GitHub Repository (format: owner/repo): " GITHUB_REPO
    # Trim whitespace
    GITHUB_REPO=$(echo "$GITHUB_REPO" | xargs)
    if [[ ! "$GITHUB_REPO" =~ ^[a-zA-Z0-9_-]+/[a-zA-Z0-9._-]+$ ]]; then
        print_error "Invalid repository format. Must be 'owner/repo'"
        exit 1
    fi
    print_info "GitHub Repository: $GITHUB_REPO"

    # Confirm
    echo ""
    print_warning "About to create the following resources:"
    echo "  - OIDC Provider: $OIDC_PROVIDER_URL"
    echo "  - IAM Role: $ROLE_NAME"
    echo "  - IAM Policy: $POLICY_NAME"
    echo "  - For Repository: $GITHUB_REPO"
    echo ""
    read -p "Continue? (yes/no): " CONFIRM
    if [[ "$CONFIRM" != "yes" ]]; then
        print_info "Setup cancelled."
        exit 0
    fi
}

#############################################################################
# Create OIDC Provider
#############################################################################

create_oidc_provider() {
    print_header "Creating OIDC Provider"

    # Check if provider already exists
    PROVIDER_ARN=$(aws iam list-open-id-connect-providers --output json | \
        jq -r ".OpenIDConnectProviderList[] | select(.Arn | contains(\"$OIDC_PROVIDER_URL\")) | .Arn" || echo "")

    if [[ -n "$PROVIDER_ARN" ]]; then
        print_warning "OIDC Provider already exists: $PROVIDER_ARN"
    else
        PROVIDER_ARN=$(aws iam create-open-id-connect-provider \
            --url "https://$OIDC_PROVIDER_URL" \
            --client-id-list "sts.amazonaws.com" \
            --thumbprint-list "$THUMBPRINT_1" "$THUMBPRINT_2" \
            --tags "Key=Environment,Value=prod" \
                   "Key=ManagedBy,Value=bootstrap-script" \
                   "Key=Owner,Value=John Xanthopoulos" \
                   "Key=Project,Value=aws-services" \
                   "Key=Service,Value=aws-service-report-generator" \
                   "Key=GithubRepo,Value=github.com/jxman/aws-services-reporter" \
                   "Key=Name,Value=GitHubActionsOIDC-$PROJECT_NAME" \
                   "Key=SubService,Value=github-oidc-provider" \
            --query 'OpenIDConnectProviderArn' \
            --output text)
        print_success "OIDC Provider created: $PROVIDER_ARN"
    fi
}

#############################################################################
# Create IAM Policy
#############################################################################

create_iam_policy() {
    print_header "Creating IAM Policy"

    # Create policy document
    POLICY_DOC=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFormationAccess",
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateStack",
        "cloudformation:UpdateStack",
        "cloudformation:DeleteStack",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "cloudformation:DescribeStackResources",
        "cloudformation:GetTemplate",
        "cloudformation:ValidateTemplate",
        "cloudformation:CreateChangeSet",
        "cloudformation:DescribeChangeSet",
        "cloudformation:ExecuteChangeSet",
        "cloudformation:DeleteChangeSet",
        "cloudformation:ListStacks",
        "cloudformation:GetTemplateSummary"
      ],
      "Resource": [
        "arn:aws:cloudformation:${AWS_REGION}:${AWS_ACCOUNT_ID}:stack/aws-service-report-generator/*",
        "arn:aws:cloudformation:${AWS_REGION}:${AWS_ACCOUNT_ID}:stack/aws-sam-cli-managed-default/*",
        "arn:aws:cloudformation:${AWS_REGION}:aws:transform/Serverless-2016-10-31"
      ]
    },
    {
      "Sid": "LambdaAccess",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:DeleteFunction",
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:ListFunctions",
        "lambda:ListVersionsByFunction",
        "lambda:PublishVersion",
        "lambda:CreateAlias",
        "lambda:UpdateAlias",
        "lambda:DeleteAlias",
        "lambda:GetAlias",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:InvokeFunction",
        "lambda:TagResource",
        "lambda:UntagResource",
        "lambda:ListTags"
      ],
      "Resource": "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:aws-service-report-generator*"
    },
    {
      "Sid": "IAMRoleAccess",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:PassRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRolePolicy",
        "iam:TagRole",
        "iam:UntagRole"
      ],
      "Resource": [
        "arn:aws:iam::${AWS_ACCOUNT_ID}:role/aws-service-report-*",
        "arn:aws:iam::${AWS_ACCOUNT_ID}:role/sam-*"
      ]
    },
    {
      "Sid": "S3Access",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:GetBucketPolicy",
        "s3:PutBucketPolicy",
        "s3:DeleteBucketPolicy",
        "s3:GetBucketVersioning",
        "s3:PutBucketVersioning",
        "s3:GetBucketNotification",
        "s3:PutBucketNotification",
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:GetObjectVersion",
        "s3:DeleteObjectVersion",
        "s3:ListBucketVersions"
      ],
      "Resource": [
        "arn:aws:s3:::aws-sam-cli-managed-default-samclisourcebucket-*",
        "arn:aws:s3:::aws-sam-cli-managed-default-samclisourcebucket-*/*",
        "arn:aws:s3:::aws-data-fetcher-output",
        "arn:aws:s3:::aws-data-fetcher-output/*"
      ]
    },
    {
      "Sid": "SNSAccess",
      "Effect": "Allow",
      "Action": [
        "sns:CreateTopic",
        "sns:DeleteTopic",
        "sns:GetTopicAttributes",
        "sns:SetTopicAttributes",
        "sns:Subscribe",
        "sns:Unsubscribe",
        "sns:Publish",
        "sns:ListTopics",
        "sns:ListSubscriptionsByTopic",
        "sns:TagResource",
        "sns:UntagResource"
      ],
      "Resource": "arn:aws:sns:${AWS_REGION}:${AWS_ACCOUNT_ID}:aws-service-report-*"
    },
    {
      "Sid": "KMSAccess",
      "Effect": "Allow",
      "Action": [
        "kms:CreateKey",
        "kms:DescribeKey",
        "kms:GetKeyPolicy",
        "kms:PutKeyPolicy",
        "kms:EnableKeyRotation",
        "kms:DisableKeyRotation",
        "kms:GetKeyRotationStatus",
        "kms:ScheduleKeyDeletion",
        "kms:CancelKeyDeletion",
        "kms:TagResource",
        "kms:UntagResource",
        "kms:ListResourceTags",
        "kms:CreateAlias",
        "kms:DeleteAlias",
        "kms:UpdateAlias"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "${AWS_REGION}"
        }
      }
    },
    {
      "Sid": "CloudWatchLogsAccess",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:DeleteLogGroup",
        "logs:DescribeLogGroups",
        "logs:PutRetentionPolicy",
        "logs:DeleteRetentionPolicy",
        "logs:TagLogGroup",
        "logs:UntagLogGroup"
      ],
      "Resource": "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:/aws/lambda/aws-service-report-generator*"
    },
    {
      "Sid": "CloudWatchAlarmsAccess",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricAlarm",
        "cloudwatch:DeleteAlarms",
        "cloudwatch:DescribeAlarms",
        "cloudwatch:TagResource",
        "cloudwatch:UntagResource"
      ],
      "Resource": "arn:aws:cloudwatch:${AWS_REGION}:${AWS_ACCOUNT_ID}:alarm:aws-service-report-*"
    },
    {
      "Sid": "EventBridgeAccess",
      "Effect": "Allow",
      "Action": [
        "events:PutRule",
        "events:DeleteRule",
        "events:DescribeRule",
        "events:PutTargets",
        "events:RemoveTargets",
        "events:ListTargetsByRule",
        "events:TagResource",
        "events:UntagResource"
      ],
      "Resource": "arn:aws:events:${AWS_REGION}:${AWS_ACCOUNT_ID}:rule/aws-service-report-*"
    },
    {
      "Sid": "IAMPolicyAccess",
      "Effect": "Allow",
      "Action": [
        "iam:CreatePolicy",
        "iam:DeletePolicy",
        "iam:GetPolicy",
        "iam:GetPolicyVersion",
        "iam:ListPolicyVersions",
        "iam:CreatePolicyVersion",
        "iam:DeletePolicyVersion"
      ],
      "Resource": "arn:aws:iam::${AWS_ACCOUNT_ID}:policy/aws-service-report-*"
    }
  ]
}
EOF
)

    # Check if policy already exists
    POLICY_ARN=$(aws iam list-policies --scope Local --query "Policies[?PolicyName=='$POLICY_NAME'].Arn" --output text || echo "")

    if [[ -n "$POLICY_ARN" ]]; then
        print_warning "IAM Policy already exists: $POLICY_ARN"
    else
        POLICY_ARN=$(aws iam create-policy \
            --policy-name "$POLICY_NAME" \
            --policy-document "$POLICY_DOC" \
            --description "Policy for GitHub Actions to deploy AWS Services Reporter SAM application" \
            --tags "Key=Environment,Value=prod" \
                   "Key=ManagedBy,Value=bootstrap-script" \
                   "Key=Owner,Value=John Xanthopoulos" \
                   "Key=Project,Value=aws-services" \
                   "Key=Service,Value=aws-service-report-generator" \
                   "Key=GithubRepo,Value=github.com/jxman/aws-services-reporter" \
                   "Key=Name,Value=$POLICY_NAME" \
                   "Key=SubService,Value=github-actions-policy" \
            --query 'Policy.Arn' \
            --output text)
        print_success "IAM Policy created: $POLICY_ARN"
    fi
}

#############################################################################
# Create IAM Role
#############################################################################

create_iam_role() {
    print_header "Creating IAM Role"

    # Create trust policy
    TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "$PROVIDER_ARN"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:*"
        }
      }
    }
  ]
}
EOF
)

    # Check if role already exists
    ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null || echo "")

    if [[ -n "$ROLE_ARN" ]]; then
        print_warning "IAM Role already exists: $ROLE_ARN"
        # Update trust policy in case repository changed
        aws iam update-assume-role-policy \
            --role-name "$ROLE_NAME" \
            --policy-document "$TRUST_POLICY"
        print_success "Updated trust policy for existing role"
    else
        ROLE_ARN=$(aws iam create-role \
            --role-name "$ROLE_NAME" \
            --assume-role-policy-document "$TRUST_POLICY" \
            --description "Role for GitHub Actions to deploy AWS Services Reporter SAM application" \
            --tags "Key=Environment,Value=prod" \
                   "Key=ManagedBy,Value=bootstrap-script" \
                   "Key=Owner,Value=John Xanthopoulos" \
                   "Key=Project,Value=aws-services" \
                   "Key=Service,Value=aws-service-report-generator" \
                   "Key=GithubRepo,Value=github.com/jxman/aws-services-reporter" \
                   "Key=Name,Value=$ROLE_NAME" \
                   "Key=SubService,Value=github-actions-role" \
            --query 'Role.Arn' \
            --output text)
        print_success "IAM Role created: $ROLE_ARN"
    fi
}

#############################################################################
# Attach Policy to Role
#############################################################################

attach_policy() {
    print_header "Attaching Policy to Role"

    # Check if already attached
    ATTACHED=$(aws iam list-attached-role-policies --role-name "$ROLE_NAME" --query "AttachedPolicies[?PolicyArn=='$POLICY_ARN'].PolicyArn" --output text || echo "")

    if [[ -n "$ATTACHED" ]]; then
        print_warning "Policy already attached to role"
    else
        aws iam attach-role-policy \
            --role-name "$ROLE_NAME" \
            --policy-arn "$POLICY_ARN"
        print_success "Policy attached to role"
    fi
}

#############################################################################
# Display Summary
#############################################################################

display_summary() {
    print_header "Setup Complete!"

    echo -e "${GREEN}✓ OIDC Provider created/verified${NC}"
    echo -e "${GREEN}✓ IAM Role created/verified${NC}"
    echo -e "${GREEN}✓ IAM Policy created/verified${NC}"
    echo -e "${GREEN}✓ Policy attached to role${NC}"
    echo ""

    print_header "Next Steps"

    echo "1. Add the following secret to your GitHub repository:"
    echo ""
    echo -e "   ${BLUE}Secret Name:${NC}  AWS_ROLE_ARN"
    echo -e "   ${BLUE}Secret Value:${NC} $ROLE_ARN"
    echo ""
    echo "2. Navigate to your repository settings:"
    echo -e "   ${BLUE}https://github.com/${GITHUB_REPO}/settings/secrets/actions${NC}"
    echo ""
    echo "3. Click 'New repository secret' and add the above values"
    echo ""
    echo "4. Push your code to trigger the GitHub Actions workflow"
    echo ""

    print_info "Role ARN saved to: oidc-role-arn.txt"
    echo "$ROLE_ARN" > oidc-role-arn.txt
}

#############################################################################
# Main Execution
#############################################################################

main() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║  GitHub Actions OIDC Setup for AWS Services Reporter      ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    check_prerequisites
    get_inputs
    create_oidc_provider
    create_iam_policy
    create_iam_role
    attach_policy
    display_summary
}

# Run main function
main
