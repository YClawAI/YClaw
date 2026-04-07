variable "project_name" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "cost_tier" {
  type    = string
  default = "starter"
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}
