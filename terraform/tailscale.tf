# ─── Tailscale Subnet Router ──────────────────────────────────────────────────
#
# STATUS: DEPLOYED. Private subnet, no public IP, DERP relay, nmap-clean.
# See .ai/PRODUCTION-SECURITY-RUNBOOK.md for full architecture.
#
# A lightweight EC2 instance that bridges the Tailscale tailnet into the VPC.
# Runs in a private subnet with NO public IP — Tailscale connects outbound via
# NAT Gateway using DERP relay servers (adds ~20-50ms vs direct WireGuard).
#
# Auth key is fetched from Secrets Manager at boot time (not in user_data),
# so it never appears in Terraform state or DescribeInstanceAttribute.
#
# Tailnet: <YOUR_TAILNET>
# Auth key: Secrets Manager → yclaw/production/tailscale-auth-key

variable "enable_tailscale_router" {
  description = "Whether to create the Tailscale subnet router instance. Independent of auth key."
  type        = bool
  default     = true
}

variable "tailscale_auth_key" {
  description = "Tailscale auth key — only needed for first deploy. After that, the instance fetches from Secrets Manager."
  type        = string
  sensitive   = true
  default     = ""
}

# Use SSM parameter for latest Amazon Linux 2023 AMI (always up to date)
data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-x86_64"
}

# ─── Security Group ───────────────────────────────────────────────────────────
# No public ingress. All Tailscale traffic is outbound (DERP relay via NAT GW).

resource "aws_security_group" "tailscale_router" {
  name        = "yclaw-tailscale-router-${var.environment}"
  description = "Tailscale subnet router - private subnet, no inbound"
  vpc_id      = var.vpc_id

  # VPC internal only (return traffic from ALB, forwarded packets)
  ingress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["10.0.0.0/16"]
    description = "VPC internal"
  }

  # Outbound: Tailscale DERP relay (443/TCP) + coordination (various) + VPC routing
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "All outbound (DERP relay, Tailscale coordination, VPC)"
  }
}

# ─── IAM (SSM + Secrets Manager access) ──────────────────────────────────────

resource "aws_iam_role" "tailscale_router" {
  name = "yclaw-tailscale-router-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "tailscale_ssm" {
  role       = aws_iam_role.tailscale_router.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Allow the instance to read its auth key from Secrets Manager at boot
resource "aws_iam_role_policy" "tailscale_secrets" {
  name = "tailscale-secrets-access"
  role = aws_iam_role.tailscale_router.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = ["arn:aws:secretsmanager:${var.aws_region}:*:secret:yclaw/*/tailscale-auth-key*"]
    }]
  })
}

resource "aws_iam_instance_profile" "tailscale_router" {
  name = "yclaw-tailscale-router-${var.environment}"
  role = aws_iam_role.tailscale_router.name
}

# ─── EC2 Instance ─────────────────────────────────────────────────────────────
# Private subnet, no public IP. Auth key fetched from Secrets Manager at boot.
# Lifecycle controlled by var.enable_tailscale_router (not the auth key).

resource "aws_instance" "tailscale_router" {
  count = var.enable_tailscale_router ? 1 : 0

  ami                    = data.aws_ssm_parameter.al2023_ami.value
  instance_type          = "t3.micro"
  subnet_id              = var.private_subnet_ids[0]
  vpc_security_group_ids = [aws_security_group.tailscale_router.id]
  iam_instance_profile   = aws_iam_instance_profile.tailscale_router.name

  associate_public_ip_address = false
  source_dest_check           = false # Required for routing

  # Auth key is NOT in user_data. Fetched from Secrets Manager at runtime.
  user_data = base64encode(<<-EOF
    #!/bin/bash
    set -euo pipefail

    # Install Tailscale + AWS CLI
    dnf config-manager --add-repo https://pkgs.tailscale.com/stable/amazon-linux/2023/tailscale.repo
    dnf install -y tailscale aws-cli

    # Enable IP forwarding
    echo 'net.ipv4.ip_forward = 1' >> /etc/sysctl.d/99-tailscale.conf
    echo 'net.ipv6.conf.all.forwarding = 1' >> /etc/sysctl.d/99-tailscale.conf
    sysctl -p /etc/sysctl.d/99-tailscale.conf

    # Fetch auth key from Secrets Manager (not from user_data/Terraform state)
    AUTH_KEY=$(aws secretsmanager get-secret-value \
      --secret-id yclaw/${var.environment}/tailscale-auth-key \
      --region ${var.aws_region} \
      --query SecretString --output text)

    # Start and authenticate
    systemctl enable --now tailscaled
    tailscale up \
      --authkey="$AUTH_KEY" \
      --advertise-routes=10.0.0.0/16 \
      --hostname=yclaw-subnet-router \
      --accept-dns=false

    # Clear the variable
    unset AUTH_KEY
  EOF
  )

  tags = {
    Name = "yclaw-tailscale-router-${var.environment}"
  }

  lifecycle {
    ignore_changes = [ami, user_data]
  }
}

# ─── Outputs ──────────────────────────────────────────────────────────────────

output "tailscale_router_id" {
  value = length(aws_instance.tailscale_router) > 0 ? aws_instance.tailscale_router[0].id : "not deployed (set tailscale_auth_key)"
}

output "tailscale_router_private_ip" {
  value = length(aws_instance.tailscale_router) > 0 ? aws_instance.tailscale_router[0].private_ip : "n/a"
}
