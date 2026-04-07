# AWS Deployment

Production deployment on AWS using ECS Fargate, managed databases, and Terraform.

---

## Prerequisites

- **AWS account** with permissions to create VPC, ECS, RDS, ElastiCache, S3, Secrets Manager, CloudWatch, and IAM resources
- **Terraform** >= 1.5.0
- **AWS CLI** configured with valid credentials (`aws sts get-caller-identity` succeeds)
- **Node.js 20 LTS** (for the `yclaw` CLI)

### Required Terraform Providers

| Provider | Version |
|----------|---------|
| `hashicorp/aws` | `~> 5.0` |
| `hashicorp/random` | `~> 3.0` |

---

## Quick Start

```bash
yclaw init --preset aws-production    # generates terraform.auto.tfvars.json
cd deploy/aws
terraform init
terraform plan
terraform apply
```

`yclaw init` generates the variable file from your `yclaw.config.yaml`. You can also copy `terraform.tfvars.example` and fill it in manually.

---

## Module Breakdown

The root module (`deploy/aws/main.tf`) composes seven sub-modules. Each is in `deploy/aws/modules/<name>/`.

### monitoring

Creates the CloudWatch log group used by both ECS services.

| Resource | Description |
|----------|-------------|
| `aws_cloudwatch_log_group` | `/ecs/${project_name}`, retention configurable via `log_retention_days` (default: 14) |

Container Insights is enabled on the ECS cluster when `cost_tier = "production"`.

### networking

Creates the VPC, subnets, internet gateway, and security groups. Behavior differs by cost tier.

| Resource | Starter | Production |
|----------|---------|------------|
| VPC | 1 VPC with DNS hostnames enabled | Same |
| Public subnets | 2 (one per AZ) | 2 (one per AZ) |
| Private subnets | None | 2 (one per AZ) |
| NAT gateways | None | 1 per AZ (2 total) |
| Internet gateway | 1 | 1 |

**Security groups** (3 total):

| SG | Ingress | Description |
|----|---------|-------------|
| **ALB** | 80/tcp and 443/tcp from `0.0.0.0/0` | Public-facing load balancer |
| **ECS** | 3000-3001/tcp from ALB SG only | Container tasks -- no direct public access |
| **Database** | 27017 (DocumentDB), 5432 (PostgreSQL), 6379 (Redis) from ECS SG only | Data stores accept only ECS traffic |

In starter tier, ECS tasks run in public subnets with `assign_public_ip = true` (needed for ECR image pulls without NAT). In production tier, tasks run in private subnets behind NAT gateways.

### database

Always provisions **RDS PostgreSQL 16** for the memory system. Optionally provisions **DocumentDB** for MongoDB-compatible storage.

| Variable | Effect |
|----------|--------|
| `database_type = "external"` (default) | No DocumentDB. You provide `mongodb_uri` (e.g., MongoDB Atlas). |
| `database_type = "documentdb"` | Creates an AWS DocumentDB cluster with MongoDB compatibility. |

| Resource | Starter | Production |
|----------|---------|------------|
| RDS instance class | `db.t4g.micro` | `db.t4g.small` |
| RDS multi-AZ | No | Yes |
| RDS storage | 20 GB, auto-scales to 100 GB, encrypted | Same |
| RDS backups | 1 day retention | 7 days retention |
| RDS deletion protection | Off | On |
| DocumentDB instances | 1x `db.t4g.medium` | 2x `db.t4g.medium` |
| DocumentDB backups | 1 day retention | 7 days retention |

Passwords are auto-generated via the `random_password` resource (32 characters, no special characters).

### cache

Creates an **ElastiCache Redis 7.1** replication group.

| Aspect | Starter | Production |
|--------|---------|------------|
| Node type | `cache.t4g.micro` | `cache.t4g.small` |
| Nodes | 1 | 2 |
| Multi-AZ | No | Yes |
| Automatic failover | No | Yes |
| Snapshots | Disabled | 3-day retention |

Both tiers have transit encryption and at-rest encryption enabled.

### storage

Creates a private **S3 bucket** for object storage (artifacts, attachments).

| Feature | Detail |
|---------|--------|
| Bucket name | `${project_name}-objects-${account_id}-${random_hex}` |
| Versioning | Enabled |
| Encryption | AES256 (SSE-S3) |
| Public access | Fully blocked (all four block settings enabled) |
| Lifecycle | Non-current versions expire after 30 days |
| Force destroy | Enabled for starter tier, disabled for production |

### secrets

Stores application credentials in **AWS Secrets Manager**, one secret per key. ECS task definitions reference secrets by ARN (injected at container start, never in plaintext environment).

| Secret Key | Source |
|------------|--------|
| `MONGODB_URI` | From DocumentDB connection string or user-provided `mongodb_uri` |
| `MEMORY_DATABASE_URL` | Auto-generated from RDS endpoint |
| `YCLAW_SETUP_TOKEN` | From `setup_token` variable |
| `EVENT_BUS_SECRET` | From `event_bus_secret` variable |
| LLM API key | Key name varies by `llm_provider`: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OPENROUTER_API_KEY` |

Secrets are named `${project_name}/${KEY}` in Secrets Manager. Recovery window is set to 0 (immediate deletion) for clean teardown support.

### compute

Creates the ECS Fargate cluster, ALB, task definitions, services, and IAM roles.

**ECS Cluster:**
- Container Insights enabled in production tier only.

**ALB (Application Load Balancer):**
- Public-facing, in public subnets.
- HTTP listener (port 80) always present. Redirects to HTTPS (301) if `acm_certificate_arn` is provided; otherwise forwards to Mission Control.
- HTTPS listener (port 443) created only when `acm_certificate_arn` is set. TLS policy: `ELBSecurityPolicy-TLS13-1-2-2021-06`.

**Path-based routing:**

| Path Pattern | Target |
|-------------|--------|
| `/api/*`, `/health`, `/health/*`, `/v1/*`, `/github/*` | Core API (port 3000) -- priority 10 |
| Everything else (default) | Mission Control (port 3001) |

**ECS Services (2):**

| Service | Task CPU | Task Memory | Desired Count |
|---------|----------|-------------|---------------|
| `${project_name}-core` | 256 (starter) / 512 (production) | 512 MB (starter) / 1024 MB (production) | 1 (starter) / 2 (production) |
| `${project_name}-mc` | 256 | 512 MB | 1 (starter) / 2 (production) |

**IAM Roles (3):**

| Role | Permissions |
|------|-------------|
| ECS execution role | ECR pull, CloudWatch Logs write, Secrets Manager read (scoped to YCLAW secret ARNs) |
| Core task role | S3 access (Get, Put, Delete, List, Head on the objects bucket) |
| MC task role | No additional permissions (baseline ECS task role) |

**Container environment:**

Core container receives non-sensitive config as plaintext environment variables (`NODE_ENV`, `PORT`, `YCLAW_S3_BUCKET`, `AWS_REGION`, `REDIS_URL`) and sensitive values injected from Secrets Manager by ARN.

Mission Control container receives `HOSTNAME=0.0.0.0` (required for Next.js standalone binding on Fargate), `YCLAW_API_URL` and `NEXT_PUBLIC_YCLAW_API_URL` pointing to the public base URL.

---

## Variables Reference

All variables are defined in `deploy/aws/variables.tf`.

### General

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `project_name` | string | `"yclaw"` | Name prefix for all AWS resources |
| `aws_region` | string | `"us-east-1"` | AWS region |
| `cost_tier` | string | `"starter"` | `"starter"` (~$50-80/mo) or `"production"` (~$300+/mo) |

### Database

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `database_type` | string | `"external"` | `"external"` (provide `mongodb_uri`) or `"documentdb"` (AWS-managed) |
| `mongodb_uri` | string (sensitive) | `""` | External MongoDB URI. Required when `database_type = "external"`. |
| `rds_instance_class` | string | `""` | Override RDS instance class. Empty = auto from cost_tier. |
| `documentdb_instance_class` | string | `""` | Override DocumentDB instance class. Empty = auto from cost_tier. |

### Cache

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `redis_node_type` | string | `""` | Override ElastiCache node type. Empty = auto from cost_tier. |

### Compute

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `ecs_cpu` | number | `0` | Override Fargate CPU units. 0 = auto from cost_tier. |
| `ecs_memory` | number | `0` | Override Fargate memory (MB). 0 = auto from cost_tier. |
| `core_image` | string | `"yclaw/core:latest"` | Core runtime Docker image |
| `mc_image` | string | `"yclaw/mission-control:latest"` | Mission Control Docker image |

### HTTPS (optional)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `acm_certificate_arn` | string | `""` | ACM certificate ARN. Empty = HTTP only. |
| `domain_name` | string | `""` | Custom domain. Required when `acm_certificate_arn` is set. DNS must be configured externally (CNAME or alias to ALB). |

### Application Secrets

Pass these via `-var` flags, environment variables (`TF_VAR_*`), or a `.tfvars` file that is not committed. Never commit secrets.

| Variable | Type | Description |
|----------|------|-------------|
| `setup_token` | string (sensitive) | `YCLAW_SETUP_TOKEN` for root operator bootstrap |
| `event_bus_secret` | string (sensitive) | `EVENT_BUS_SECRET` for HMAC-signed event bus |
| `llm_provider` | string | `"anthropic"` (default), `"openai"`, or `"openrouter"` |
| `llm_api_key` | string (sensitive) | API key for the configured LLM provider |

### Monitoring

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `log_retention_days` | number | `14` | CloudWatch log retention period |

---

## Cross-Variable Validations

The root module enforces two validation rules at plan time:

1. **`mongodb_uri` required for external mode** -- When `database_type = "external"`, you must provide a non-empty `mongodb_uri`.
2. **`domain_name` required for HTTPS** -- When `acm_certificate_arn` is set, you must also set `domain_name`. The ALB's `*.elb.amazonaws.com` hostname will not match a custom ACM certificate.

---

## Required AWS Permissions

The IAM user or role running `terraform apply` needs permissions to manage:

- **VPC**: VPCs, subnets, route tables, internet gateways, NAT gateways, elastic IPs, security groups
- **ECS**: Clusters, task definitions, services
- **EC2**: Load balancers, target groups, listeners, listener rules
- **RDS**: DB instances, subnet groups
- **DocumentDB** (if `database_type = "documentdb"`): Clusters, instances, subnet groups
- **ElastiCache**: Replication groups, subnet groups
- **S3**: Buckets, bucket policies, lifecycle rules
- **Secrets Manager**: Secrets, secret versions
- **CloudWatch Logs**: Log groups
- **IAM**: Roles, policies, role-policy attachments
- **ACM** (read-only, if using HTTPS): Certificate lookup

---

## Terraform State

By default, Terraform uses local state. For team use or production, configure S3 backend with DynamoDB locking. See `deploy/aws/backend.tf.example`:

```bash
# One-time setup
aws s3 mb s3://yclaw-terraform-state-ACCOUNT_ID
aws dynamodb create-table --table-name yclaw-terraform-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

Copy `backend.tf.example` to `backend.tf`, fill in your values, and run `terraform init`.

Local state files contain secrets in plaintext and have no locking. Do not use local state for production.

---

## Cost Estimates

These are rough monthly estimates assuming `us-east-1` pricing. Actual costs vary by usage.

### Starter Tier (~$50-80/month)

| Resource | Estimate |
|----------|----------|
| ECS Fargate (2 services, 256 CPU / 512 MB each) | ~$20 |
| RDS PostgreSQL (`db.t4g.micro`, single-AZ) | ~$13 |
| ElastiCache Redis (`cache.t4g.micro`, 1 node) | ~$12 |
| ALB | ~$16 |
| S3, Secrets Manager, CloudWatch | ~$2-5 |
| **Total (external MongoDB)** | **~$63-66** |
| DocumentDB (`db.t4g.medium`, 1 instance) -- add if used | +~$55 |

### Production Tier (~$300+/month)

| Resource | Estimate |
|----------|----------|
| ECS Fargate (2 services x 2 tasks, 512 CPU / 1024 MB) | ~$60 |
| RDS PostgreSQL (`db.t4g.small`, multi-AZ) | ~$50 |
| ElastiCache Redis (`cache.t4g.small`, 2 nodes, multi-AZ) | ~$45 |
| NAT gateways (2) + data transfer | ~$65+ |
| ALB | ~$16 |
| S3, Secrets Manager, CloudWatch | ~$5-10 |
| **Total (external MongoDB)** | **~$240-245** |
| DocumentDB (`db.t4g.medium`, 2 instances) -- add if used | +~$110 |

NAT gateway costs scale with outbound data transfer. The estimates above assume moderate traffic.

---

## Outputs

After `terraform apply`, the following outputs are available:

| Output | Description |
|--------|-------------|
| `alb_url` | Full URL to access YCLAW (Mission Control + API) |
| `alb_dns_name` | Raw ALB DNS name |
| `ecs_cluster` | ECS cluster name |
| `core_service` | Core ECS service name |
| `mc_service` | Mission Control ECS service name |
| `s3_bucket` | Object storage bucket name |
| `rds_endpoint` | PostgreSQL endpoint |
| `redis_endpoint` | Redis endpoint |
| `log_group` | CloudWatch log group name |
| `aws_region` | Deployed region |
| `dns_setup_required` | DNS configuration instructions (if custom domain is set) |

---

## DNS Setup

If you set `domain_name` and `acm_certificate_arn`, the `dns_setup_required` output will tell you what DNS record to create. You must configure DNS externally (Route 53 or your DNS provider):

```
CNAME  agents.example.com  →  yclaw-alb-123456789.us-east-1.elb.amazonaws.com
```

Or, if using Route 53, create an alias record pointing to the ALB.

---

## Monitoring

- **CloudWatch Logs**: All container output is streamed to `/ecs/${project_name}`. Core logs are prefixed `core/`, Mission Control logs are prefixed `mc/`.
- **Container Insights**: Enabled automatically in production tier. Provides CPU, memory, and network metrics per service.
- **Health checks**: The ALB checks `/health` on the core API (port 3000) and `/` on Mission Control (port 3001) every 30 seconds.

View logs:

```bash
aws logs tail /ecs/yclaw --follow
aws logs tail /ecs/yclaw --filter-pattern "ERROR" --since 1h
```

---

## Tear Down

```bash
terraform destroy
```

In starter tier, S3 bucket `force_destroy` is enabled and RDS `skip_final_snapshot` is true, so teardown completes without manual intervention. In production tier, final snapshots are created for RDS and DocumentDB, and the S3 bucket must be emptied manually before destroy if it contains objects (deletion protection is on).
