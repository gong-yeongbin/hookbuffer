terraform {
  required_version = "~> 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # 버킷 이름은 계정마다 달라 init 때 넘긴다: terraform init -backend-config="bucket=<TFSTATE_BUCKET>"
  backend "s3" {
    key          = "frontend/terraform.tfstate"
    region       = "ap-northeast-2"
    use_lockfile = true
  }
}
