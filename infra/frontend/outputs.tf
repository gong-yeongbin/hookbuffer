# apply 뒤 아래 셋을 저장소 variables에 넣는다: FRONTEND_BUCKET, CLOUDFRONT_DISTRIBUTION_ID, DEPLOY_ROLE_ARN
output "bucket" {
  value = aws_s3_bucket.frontend.bucket
}

output "distribution_id" {
  value = aws_cloudfront_distribution.frontend.id
}

output "deploy_role_arn" {
  value = aws_iam_role.deploy.arn
}

output "url" {
  value = "https://${var.domain}"
}
