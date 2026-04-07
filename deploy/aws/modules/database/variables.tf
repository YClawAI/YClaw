variable "project_name" {
  type = string
}

variable "cost_tier" {
  type    = string
  default = "starter"
}

variable "database_type" {
  type        = string
  default     = "external"
  description = "external (user provides MongoDB URI) or documentdb (AWS-managed)"

  validation {
    condition     = contains(["external", "documentdb"], var.database_type)
    error_message = "database_type must be 'external' or 'documentdb'"
  }
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  type = string
}

variable "rds_instance_class" {
  type    = string
  default = ""
  description = "Override RDS instance class. Empty = auto from cost_tier."
}

variable "documentdb_instance_class" {
  type    = string
  default = ""
  description = "Override DocumentDB instance class. Empty = auto from cost_tier."
}
