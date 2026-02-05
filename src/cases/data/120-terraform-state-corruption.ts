import type { DetectiveCase } from "../../types";

export const terraformStateCorruption: DetectiveCase = {
	id: "terraform-state-corruption",
	title: "The Terraform State Corruption",
	subtitle: "Infrastructure drift from manual changes causing deployment chaos",
	difficulty: "senior",
	category: "distributed",

	crisis: {
		description:
			"Terraform plan shows it wants to destroy and recreate critical production infrastructure. Running terraform apply could cause an outage, but the state is so drifted that infrastructure changes are blocked. Nobody knows what the actual infrastructure looks like versus what Terraform thinks it looks like.",
		impact:
			"All infrastructure changes blocked for 3 days. Security patches cannot be deployed. New environment provisioning impossible. Team working overtime to reconcile state.",
		timeline: [
			{ time: "Monday 9 AM", event: "Routine terraform plan shows unexpected changes", type: "warning" },
			{ time: "Monday 10 AM", event: "Plan shows it will DESTROY production database", type: "critical" },
			{ time: "Monday 11 AM", event: "Investigation reveals manual console changes", type: "warning" },
			{ time: "Tuesday", event: "State reconciliation attempts fail", type: "critical" },
			{ time: "Wednesday", event: "Critical security patch blocked", type: "critical" },
		],
	},

	symptoms: {
		working: [
			"Production infrastructure is running fine",
			"Applications are serving traffic normally",
			"Manual AWS console access works",
			"Terraform can read current state",
			"terraform refresh partially works",
		],
		broken: [
			"terraform plan shows destructive changes",
			"State file doesn't match reality",
			"Some resources show as 'tainted'",
			"terraform apply is too risky to run",
			"New resources fail due to conflicts",
		],
	},

	clues: [
		{
			id: 1,
			title: "Terraform Plan Output",
			type: "logs",
			content: `\`\`\`
$ terraform plan

Terraform will perform the following actions:

  # aws_db_instance.production will be destroyed
  # (because aws_db_instance.production is not in configuration)
  - resource "aws_db_instance" "production" {
      - id                = "prod-db-main"
      - engine            = "postgres"
      - instance_class    = "db.r5.2xlarge"
      ...
    }

  # aws_db_instance.main will be created
  + resource "aws_db_instance" "main" {
      + id                = (known after apply)
      + engine            = "postgres"
      + instance_class    = "db.r5.xlarge"  # Different size!
      ...
    }

  # aws_security_group.api will be updated in-place
  ~ resource "aws_security_group" "api" {
      ~ ingress {
          - cidr_blocks = ["10.0.0.0/8", "172.16.0.0/12"]  # Extra CIDR!
          + cidr_blocks = ["10.0.0.0/8"]
        }
    }

Plan: 1 to add, 1 to change, 1 to destroy.

WARNING: This plan includes destructive changes!
\`\`\``,
			hint: "The database resource name changed, and there are differences in configuration...",
		},
		{
			id: 2,
			title: "Git History of Terraform Changes",
			type: "logs",
			content: `\`\`\`
$ git log --oneline terraform/

a1b2c3d (HEAD) Rename database resource for consistency
d4e5f6g Add new API endpoints
g7h8i9j Update to Terraform 1.5
j0k1l2m Initial infrastructure setup

$ git show a1b2c3d

-resource "aws_db_instance" "production" {
+resource "aws_db_instance" "main" {
   identifier = "prod-db-main"
   engine     = "postgres"
-  instance_class = "db.r5.2xlarge"
+  instance_class = "db.r5.xlarge"  # "Downsizing per cost optimization"

# Note: This rename was done without state migration!
\`\`\``,
			hint: "A resource was renamed in code but what about the state?",
		},
		{
			id: 3,
			title: "AWS Console Changes Log",
			type: "logs",
			content: `\`\`\`
CloudTrail events for production account (last 30 days):
========================================================

2024-01-10 14:23:00 - ModifyDBInstance
  User: john.developer (console)
  Changes: instance_class db.r5.xlarge -> db.r5.2xlarge
  Reason: "Emergency scaling for traffic spike"
  Note: No corresponding Terraform change

2024-01-12 09:15:00 - AuthorizeSecurityGroupIngress
  User: sarah.ops (console)
  Changes: Added 172.16.0.0/12 to api-sg
  Reason: "Allow partner network access"
  Note: No corresponding Terraform change

2024-01-15 16:45:00 - CreateDBSnapshot
  User: terraform-automation
  Changes: Created snapshot before planned maintenance
  Note: This was from Terraform

2024-01-18 11:00:00 - ModifyDBInstance
  User: john.developer (console)
  Changes: Enabled Performance Insights
  Reason: "Debugging slow queries"
  Note: No corresponding Terraform change
\`\`\``,
			hint: "Multiple manual changes were made outside of Terraform...",
		},
		{
			id: 4,
			title: "Terraform State Excerpt",
			type: "code",
			content: `\`\`\`json
{
  "version": 4,
  "terraform_version": "1.5.0",
  "resources": [
    {
      "mode": "managed",
      "type": "aws_db_instance",
      "name": "production",
      "provider": "provider[\\"registry.terraform.io/hashicorp/aws\\"]",
      "instances": [
        {
          "attributes": {
            "id": "prod-db-main",
            "instance_class": "db.r5.xlarge",
            "engine": "postgres",
            "performance_insights_enabled": false
          }
        }
      ]
    }
  ]
}

// State shows:
// - Resource named "production" (old name)
// - instance_class: db.r5.xlarge (old size)
// - performance_insights_enabled: false (old setting)

// Reality (AWS):
// - Resource exists as "prod-db-main" (same ID)
// - instance_class: db.r5.2xlarge (manually changed)
// - performance_insights_enabled: true (manually changed)
\`\`\``,
			hint: "The state file is out of sync with both the code AND reality...",
		},
		{
			id: 5,
			title: "Team Practices Investigation",
			type: "testimony",
			content: `"We have a Terraform automation pipeline, but sometimes people need to make emergency changes in the console. We always say we'll update Terraform later, but it doesn't always happen. Last month, John scaled up the database during a traffic spike because Terraform changes take 30 minutes to review and apply. Sarah added a security group rule for an urgent partner integration. We know we should use Terraform for everything, but the process is slow for emergencies."`,
		},
		{
			id: 6,
			title: "State Locking Configuration",
			type: "config",
			content: `\`\`\`hcl
# backend.tf
terraform {
  backend "s3" {
    bucket         = "company-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-locks"
    encrypt        = true
  }
}

# Note: State locking IS configured
# But that doesn't prevent:
# 1. Manual AWS console changes
# 2. Changes via AWS CLI
# 3. Other automation tools
# 4. Renaming resources in code without state migration
\`\`\``,
		},
	],

	solution: {
		diagnosis: "Terraform state drifted from manual changes and improper resource refactoring",
		keywords: [
			"terraform state",
			"drift",
			"state corruption",
			"manual changes",
			"terraform import",
			"terraform state mv",
			"state migration",
			"infrastructure as code",
		],
		rootCause: `The Terraform state corruption occurred from multiple sources:

1. **Resource rename without state migration**: A developer renamed \`aws_db_instance.production\` to \`aws_db_instance.main\` in code without running \`terraform state mv\`. Terraform sees this as "delete old resource, create new one."

2. **Manual console changes**: Emergency changes were made directly in AWS console:
   - Database scaled up (db.r5.xlarge -> db.r5.2xlarge)
   - Security group rules added
   - Performance Insights enabled

3. **No drift detection**: There was no automated process to detect when actual infrastructure diverged from Terraform state.

The combination means:
- Terraform state says "production" resource with certain config
- Terraform code says "main" resource with different config
- AWS reality is different from both

Running \`terraform apply\` would try to:
1. Delete the database (because "production" resource is gone from code)
2. Create a new database (because "main" doesn't exist in state)
3. Revert all manual changes`,
		codeExamples: [
			{
				lang: "bash",
				description: "Step 1: Refresh state to see current drift",
				code: `# First, see the drift without making changes
terraform plan -refresh-only

# Output shows differences between state and reality
# This helps identify all manual changes

# Then refresh state to match reality
terraform apply -refresh-only

# This updates STATE to match REALITY
# But doesn't fix the code vs state mismatch`,
			},
			{
				lang: "bash",
				description: "Step 2: Fix resource rename with state mv",
				code: `# The resource was renamed in code from "production" to "main"
# Need to rename it in state too

# Check current state
terraform state list | grep aws_db_instance
# Output: aws_db_instance.production

# Move the resource in state to match new name in code
terraform state mv aws_db_instance.production aws_db_instance.main

# Verify the move
terraform state list | grep aws_db_instance
# Output: aws_db_instance.main

# Now plan should not show destroy/create
terraform plan`,
			},
			{
				lang: "hcl",
				description: "Step 3: Update code to match current reality",
				code: `# database.tf - Update to match what's actually in AWS

resource "aws_db_instance" "main" {
  identifier     = "prod-db-main"
  engine         = "postgres"
  engine_version = "14.9"

  # Updated to match manual change
  instance_class = "db.r5.2xlarge"  # Was xlarge, manually scaled

  # Updated to match manual change
  performance_insights_enabled = true

  # ... rest of config
}

# security.tf - Include manually added rule

resource "aws_security_group" "api" {
  name = "api-sg"

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    # Include the manually added CIDR
    cidr_blocks = ["10.0.0.0/8", "172.16.0.0/12"]
  }
}`,
			},
			{
				lang: "yaml",
				description: "Implement drift detection in CI/CD",
				code: `# .github/workflows/terraform-drift.yml
name: Terraform Drift Detection

on:
  schedule:
    - cron: '0 */4 * * *'  # Every 4 hours
  workflow_dispatch:

jobs:
  drift-detection:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3

      - name: Terraform Init
        run: terraform init

      - name: Check for Drift
        id: drift
        run: |
          terraform plan -detailed-exitcode -out=tfplan 2>&1 | tee plan.txt
          EXIT_CODE=\${PIPESTATUS[0]}
          if [ $EXIT_CODE -eq 2 ]; then
            echo "drift=true" >> $GITHUB_OUTPUT
          fi

      - name: Alert on Drift
        if: steps.drift.outputs.drift == 'true'
        run: |
          # Send Slack alert
          curl -X POST $SLACK_WEBHOOK -d '{
            "text": "Terraform drift detected in production!",
            "attachments": [{
              "color": "warning",
              "text": "Run terraform plan to see details"
            }]
          }'

      - name: Upload Plan
        if: steps.drift.outputs.drift == 'true'
        uses: actions/upload-artifact@v4
        with:
          name: drift-plan
          path: plan.txt`,
			},
			{
				lang: "hcl",
				description: "Prevent resource recreation with lifecycle rules",
				code: `# For critical resources, prevent accidental destruction

resource "aws_db_instance" "main" {
  identifier     = "prod-db-main"
  engine         = "postgres"
  instance_class = "db.r5.2xlarge"

  # Prevent Terraform from ever destroying this
  lifecycle {
    prevent_destroy = true
  }
}

# For resources that might drift, ignore specific attributes
resource "aws_security_group" "api" {
  name = "api-sg"

  # Ignore manual rule changes (not recommended long-term)
  lifecycle {
    ignore_changes = [ingress]
  }
}

# Better: Use moved block for renames (Terraform 1.1+)
moved {
  from = aws_db_instance.production
  to   = aws_db_instance.main
}`,
			},
		],
		prevention: [
			"Never rename resources in code without using terraform state mv or moved blocks",
			"Implement automated drift detection running on schedule",
			"Require all infrastructure changes through Terraform, even emergencies",
			"Use Service Control Policies to limit manual console changes",
			"Add prevent_destroy lifecycle rule to critical resources",
			"Set up Slack/PagerDuty alerts for detected drift",
			"Create emergency Terraform change process that's faster than console",
			"Regularly audit CloudTrail for non-Terraform infrastructure changes",
		],
		educationalInsights: [
			"Terraform state is the source of truth for what Terraform manages",
			"Resource names in code are Terraform's identifiers, not AWS identifiers",
			"terraform state mv tells Terraform 'this is the same resource, just renamed'",
			"terraform refresh updates state to match reality but doesn't change reality",
			"Manual changes create 'drift' - divergence between code, state, and reality",
			"The moved block in Terraform 1.1+ is the proper way to refactor",
			"Drift detection should be automated, not discovered during deployments",
		],
	},
};
