output "bucket_name" {
  value = aws_s3_bucket.objects.id
}

output "bucket_arn" {
  value = aws_s3_bucket.objects.arn
}

output "bucket_region" {
  value = var.aws_region
}
