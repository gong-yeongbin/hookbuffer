locals {
  # AWS 관리형 정책 ID. 콘솔의 "Policies > Cache / Response headers"와 같다
  cache_policy_caching_optimized = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  response_headers_security      = "67f7725c-6f97-4210-82d7-5512b31e9d03"
  s3_origin_id                   = "s3-frontend"
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "munjigi-frontend"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  comment             = "munjigi frontend"
  default_root_object = "index.html"
  aliases             = [var.domain, "www.${var.domain}"]
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  # 한국·일본·미국·유럽. 전 세계(PriceClass_All)보다 싸고 지연 차이는 없다
  price_class = "PriceClass_200"

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = local.s3_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    target_origin_id           = local.s3_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.cache_policy_caching_optimized
    response_headers_policy_id = local.response_headers_security
  }

  # SPA fallback. 비공개 버킷(OAC)은 없는 키를 403으로 주므로 403·404 둘 다 index.html 200으로 바꾼다.
  # /app/events 같은 경로를 새로고침해도 React Router가 받는다. 캐시 TTL 0이라 index.html 갱신이 바로 반영된다
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.frontend.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
