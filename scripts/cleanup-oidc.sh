#!/bin/bash

#############################################################################
# GitHub Actions OIDC Cleanup Script for AWS Services Reporter
#
# This script removes the OIDC IAM resources created by setup-oidc.sh
#
# Resources removed:
# - IAM Role for GitHub Actions
# - IAM Policy
# - OIDC Provider (optional)
#
# Usage: ./scripts/cleanup-oidc.sh
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
        print_error "AWS CLI is not installed."
        exit 1
    fi
    print_success "AWS CLI found"

    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials not configured or invalid."
        exit 1
    fi
    print_success "AWS credentials configured"
}

#############################################################################
# Confirm Deletion
#############################################################################

confirm_deletion() {
    print_header "Cleanup Confirmation"

    print_warning "This will delete the following resources:"
    echo "  - IAM Role: $ROLE_NAME"
    echo "  - IAM Policy: $POLICY_NAME"
    echo ""
    read -p "Do you also want to delete the OIDC Provider? (yes/no) [no]: " DELETE_PROVIDER
    DELETE_PROVIDER=${DELETE_PROVIDER:-no}

    if [[ "$DELETE_PROVIDER" == "yes" ]]; then
        echo "  - OIDC Provider: $OIDC_PROVIDER_URL"
    fi
    echo ""

    print_warning "This action cannot be undone!"
    read -p "Continue with deletion? (yes/no): " CONFIRM
    if [[ "$CONFIRM" != "yes" ]]; then
        print_info "Cleanup cancelled."
        exit 0
    fi
}

#############################################################################
# Detach Policy from Role
#############################################################################

detach_policy() {
    print_header "Detaching Policy from Role"

    # Get policy ARN
    POLICY_ARN=$(aws iam list-policies --scope Local --query "Policies[?PolicyName=='$POLICY_NAME'].Arn" --output text 2>/dev/null || echo "")

    if [[ -z "$POLICY_ARN" ]]; then
        print_warning "Policy not found, skipping detach"
        return
    fi

    # Check if role exists
    if ! aws iam get-role --role-name "$ROLE_NAME" &>/dev/null; then
        print_warning "Role not found, skipping detach"
        return
    fi

    # Detach policy
    aws iam detach-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-arn "$POLICY_ARN" 2>/dev/null || print_warning "Policy not attached or already detached"

    print_success "Policy detached from role"
}

#############################################################################
# Delete IAM Role
#############################################################################

delete_role() {
    print_header "Deleting IAM Role"

    if ! aws iam get-role --role-name "$ROLE_NAME" &>/dev/null; then
        print_warning "Role does not exist, skipping"
        return
    fi

    aws iam delete-role --role-name "$ROLE_NAME"
    print_success "IAM Role deleted: $ROLE_NAME"
}

#############################################################################
# Delete IAM Policy
#############################################################################

delete_policy() {
    print_header "Deleting IAM Policy"

    POLICY_ARN=$(aws iam list-policies --scope Local --query "Policies[?PolicyName=='$POLICY_NAME'].Arn" --output text 2>/dev/null || echo "")

    if [[ -z "$POLICY_ARN" ]]; then
        print_warning "Policy does not exist, skipping"
        return
    fi

    # Delete all non-default policy versions first
    VERSIONS=$(aws iam list-policy-versions --policy-arn "$POLICY_ARN" --query "Versions[?!IsDefaultVersion].VersionId" --output text)
    for VERSION in $VERSIONS; do
        aws iam delete-policy-version --policy-arn "$POLICY_ARN" --version-id "$VERSION"
        print_info "Deleted policy version: $VERSION"
    done

    aws iam delete-policy --policy-arn "$POLICY_ARN"
    print_success "IAM Policy deleted: $POLICY_NAME"
}

#############################################################################
# Delete OIDC Provider
#############################################################################

delete_oidc_provider() {
    if [[ "$DELETE_PROVIDER" != "yes" ]]; then
        print_info "Skipping OIDC Provider deletion (can be shared across projects)"
        return
    fi

    print_header "Deleting OIDC Provider"

    PROVIDER_ARN=$(aws iam list-open-id-connect-providers --output json | \
        jq -r ".OpenIDConnectProviderList[] | select(.Arn | contains(\"$OIDC_PROVIDER_URL\")) | .Arn" || echo "")

    if [[ -z "$PROVIDER_ARN" ]]; then
        print_warning "OIDC Provider does not exist, skipping"
        return
    fi

    aws iam delete-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER_ARN"
    print_success "OIDC Provider deleted"
}

#############################################################################
# Display Summary
#############################################################################

display_summary() {
    print_header "Cleanup Complete!"

    echo -e "${GREEN}✓ All specified resources have been removed${NC}"
    echo ""

    print_info "You can re-run setup-oidc.sh to recreate these resources if needed"
}

#############################################################################
# Main Execution
#############################################################################

main() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║  GitHub Actions OIDC Cleanup for AWS Services Reporter    ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    check_prerequisites
    confirm_deletion
    detach_policy
    delete_role
    delete_policy
    delete_oidc_provider
    display_summary
}

# Run main function
main
