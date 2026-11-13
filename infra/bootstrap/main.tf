# 딱 한 번, 로컬에서 apply한다. 이후 Terraform(infra/frontend 등)은 GitHub Actions가 여기서 만든 역할로 돌린다.
#   cd infra/bootstrap && terraform init && terraform apply
# 출력 role_arn·state_bucket을 저장소 variables TERRAFORM_ROLE_ARN·TFSTATE_BUCKET에 넣는다.

provider "aws" {
  region = var.region
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
}

# ── Terraform state ───────────────────────────────────────────────────────────

resource "aws_s3_bucket" "tfstate" {
  bucket = "munjigi-tfstate-${local.account_id}"
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ── GitHub Actions OIDC ───────────────────────────────────────────────────────

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# 이 저장소의 어떤 브랜치·PR이든 Terraform을 돌릴 수 있다(plan은 PR, apply는 main). 배포 역할은 infra/frontend가 따로 만든다
data "aws_iam_policy_document" "terraform_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:*"]
    }
  }
}

resource "aws_iam_role" "terraform" {
  name               = "munjigi-terraform"
  assume_role_policy = data.aws_iam_policy_document.terraform_trust.json
}

# 프론트 배포에 필요한 서비스만. AdministratorAccess는 쓰지 않는다. 백엔드(ECS·RDS)를 올릴 때 statement를 더한다
data "aws_iam_policy_document" "terraform" {
  statement {
    sid       = "State"
    actions   = ["s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = [aws_s3_bucket.tfstate.arn, "${aws_s3_bucket.tfstate.arn}/*"]
  }
  statement {
    sid       = "FrontendBuckets"
    actions   = ["s3:*"]
    resources = ["arn:aws:s3:::munjigi-*", "arn:aws:s3:::munjigi-*/*"]
  }
  statement {
    sid       = "Edge"
    actions   = ["cloudfront:*", "acm:*", "route53:*"]
    resources = ["*"]
  }
  statement {
    sid = "DeployRoles"
    actions = [
      "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:UpdateRole", "iam:UpdateAssumeRolePolicy",
      "iam:TagRole", "iam:UntagRole", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:ListInstanceProfilesForRole",
      "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy",
    ]
    resources = ["arn:aws:iam::${local.account_id}:role/munjigi-*"]
  }
  # data "aws_iam_openid_connect_provider"가 URL로 공급자를 찾을 때 List를 먼저 부른다. List는 리소스를 못 좁혀 *
  statement {
    sid       = "ListOidc"
    actions   = ["iam:ListOpenIDConnectProviders"]
    resources = ["*"]
  }
  statement {
    sid       = "ReadOidc"
    actions   = ["iam:GetOpenIDConnectProvider"]
    resources = [aws_iam_openid_connect_provider.github.arn]
  }
}

resource "aws_iam_role_policy" "terraform" {
  name   = "munjigi-terraform"
  role   = aws_iam_role.terraform.id
  policy = data.aws_iam_policy_document.terraform.json
}
