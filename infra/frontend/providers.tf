provider "aws" {
  region = var.region
}

# CloudFront에 붙이는 ACM 인증서는 us-east-1에만 있을 수 있다
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

data "aws_caller_identity" "current" {}
