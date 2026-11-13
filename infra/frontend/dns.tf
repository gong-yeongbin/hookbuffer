# 도메인은 선택 사항이다. var.domain이 비어 있으면 아래 전부를 만들지 않고 CloudFront 기본 주소(*.cloudfront.net)로 연다.
# 도메인을 넣을 때는 호스팅 존이 이미 있어야 한다(Route 53에서 등록하면 같이 생긴다). 여기서는 인증서 검증 레코드와 apex·www ALIAS만 넣는다.
# CloudFront의 호스팅 존 ID(cloudfront_zone_id)는 전 계정 공통 상수다

locals {
  use_domain         = var.domain != ""
  hosts              = toset(local.use_domain ? [var.domain, "www.${var.domain}"] : [])
  cloudfront_zone_id = "Z2FDTNDATAQYW2"
}

data "aws_route53_zone" "root" {
  count = local.use_domain ? 1 : 0
  name  = "${var.domain}."
}

resource "aws_acm_certificate" "frontend" {
  count                     = local.use_domain ? 1 : 0
  provider                  = aws.us_east_1
  domain_name               = var.domain
  subject_alternative_names = ["www.${var.domain}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# 검증 레코드의 for_each 키는 도메인 이름(local.hosts, 변수에서 바로 안다)으로 두고 값만 인증서에서 찾는다.
# domain_validation_options를 키로 쓰면 인증서가 없는 첫 plan에서 "apply 전엔 알 수 없다"며 거부된다
locals {
  acm_validation = local.use_domain ? { for dvo in aws_acm_certificate.frontend[0].domain_validation_options : dvo.domain_name => dvo } : {}
}

resource "aws_route53_record" "acm_validation" {
  for_each        = local.hosts
  zone_id         = data.aws_route53_zone.root[0].zone_id
  name            = local.acm_validation[each.key].resource_record_name
  type            = local.acm_validation[each.key].resource_record_type
  ttl             = 60
  records         = [local.acm_validation[each.key].resource_record_value]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "frontend" {
  count                   = local.use_domain ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.frontend[0].arn
  validation_record_fqdns = [for r in aws_route53_record.acm_validation : r.fqdn]
}

resource "aws_route53_record" "a" {
  for_each = local.hosts
  zone_id  = data.aws_route53_zone.root[0].zone_id
  name     = each.value
  type     = "A"
  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = local.cloudfront_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "aaaa" {
  for_each = local.hosts
  zone_id  = data.aws_route53_zone.root[0].zone_id
  name     = each.value
  type     = "AAAA"
  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = local.cloudfront_zone_id
    evaluate_target_health = false
  }
}
