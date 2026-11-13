variable "region" {
  description = "state 버킷·IAM을 두는 리전"
  type        = string
  default     = "ap-northeast-2"
}

variable "github_repo" {
  description = "Terraform을 돌릴 수 있는 GitHub 저장소. OIDC sub가 immutable subject 형식이라 owner@ownerId/name@repoId로 쓴다(gh api repos/<o>/<r>/actions/oidc/customization/sub의 sub_claim_prefix). 저장소 이름이 바뀌어도 유효하다"
  type        = string
  default     = "gong-yeongbin@20896639/hookbuffer@1381437467"
}
