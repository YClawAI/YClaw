variable "project_name" {
  type = string
}

variable "secret_values" {
  type        = map(string)
  sensitive   = true
  default     = {}
  description = "Map of secret name → value to store in Secrets Manager"
}
