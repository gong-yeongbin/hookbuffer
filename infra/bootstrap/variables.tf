variable "region" {
  description = "state 버킷·IAM을 두는 리전"
  type        = string
  default     = "ap-northeast-2"
}

variable "github_repo" {
  description = "Terraform을 돌릴 수 있는 GitHub 저장소(owner/name)"
  type        = string
  default     = "gong-yeongbin/hookbuffer"
}
