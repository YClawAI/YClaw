variable "project_name" {
  type = string
}

variable "cost_tier" {
  type    = string
  default = "starter"
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  type = string
}

variable "redis_node_type" {
  type        = string
  default     = ""
  description = "Override Redis node type. Empty = auto from cost_tier."
}
