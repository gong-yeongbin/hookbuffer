terraform {
  required_version = "~> 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
  # bootstrap의 state는 로컬 파일이다(*.tfstate는 git 제외). state 버킷을 만드는 쪽이라 S3 backend를 쓸 수 없다
}
