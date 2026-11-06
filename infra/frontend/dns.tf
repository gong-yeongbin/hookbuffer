# 호스팅 존은 이미 있다(사용자가 만듦). 인증서 검증 레코드와 apex·www ALIAS만 넣는다

data "aws_route53_zone" "root" {
  name = "${var.domain}."
}

resource "aws_acm_certificate" "frontend" {
  provider                  = aws.us_east_1
  domain_name               = var.domain
  subject_alternative_names = ["www.${var.domain}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "acm_validation" {
  for_each = {
    for dvo in aws_acm_certificate.frontend.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = data.aws_route53_zone.root.zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "frontend" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.frontend.arn
  validation_record_fqdns = [for r in aws_route53_record.acm_validation : r.fqdn]
}

# CloudFront의 호스팅 존 ID는 전 계정 공통 상수다
locals {
  cloudfront_zone_id = "Z2FDTNDATAQYW2"
  hosts              = toset([var.domain, "www.${var.domain}"])
}

resource "aws_route53_record" "a" {
  for_each = local.hosts
  zone_id  = data.aws_route53_zone.root.zone_id
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
  zone_id  = data.aws_route53_zone.root.zone_id
  name     = each.value
  type     = "AAAA"
  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = local.cloudfront_zone_id
    evaluate_target_health = false
  }
}
