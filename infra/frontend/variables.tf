variable "region" {
  description = "S3·IAM 리전. CloudFront는 글로벌, 인증서만 us-east-1"
  type        = string
  default     = "ap-northeast-2"
}

variable "domain" {
  description = "Route 53 호스팅 존이 있는 도메인. 비우면 인증서·DNS 없이 *.cloudfront.net 주소로 연다. 넣으면 apex와 www를 CloudFront에 붙인다"
  type        = string
  default     = "munjigi.dev"
}

variable "github_repo" {
  description = "배포 역할을 assume할 수 있는 GitHub 저장소. OIDC sub가 immutable subject 형식이라 이름 자리는 *로 두고 소유자 ID·저장소 ID에만 묶는다. bootstrap의 github_repo와 같은 값"
  type        = string
  default     = "*@20896639/*@1381437467"
}
