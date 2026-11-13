variable "region" {
  description = "state 버킷·IAM을 두는 리전"
  type        = string
  default     = "ap-northeast-2"
}

variable "github_repo" {
  description = "Terraform을 돌릴 수 있는 GitHub 저장소. OIDC sub가 immutable subject 형식(repo:owner@ownerId/name@repoId:…)이라 이름 자리는 *로 두고 소유자 ID·저장소 ID에만 묶는다. 저장소나 소유자 이름이 바뀌어도 유효하다. ID는 gh api repos/<o>/<r> 의 owner.id·id"
  type        = string
  default     = "*@20896639/*@1381437467"
}
