output "state_bucket" {
  description = "저장소 variable TFSTATE_BUCKET에 넣는다"
  value       = aws_s3_bucket.tfstate.bucket
}

output "terraform_role_arn" {
  description = "저장소 variable TERRAFORM_ROLE_ARN에 넣는다"
  value       = aws_iam_role.terraform.arn
}

output "oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}
