
resource "aws_route53_zone" "primary_domain" {
  name = var.primary_domain
}

resource "aws_acm_certificate" "primary_domain_cert" {
  provider = aws.us-east-1
  domain_name = aws_route53_zone.primary_domain.name
  validation_method = "DNS"
  subject_alternative_names = [
    aws_route53_zone.primary_domain.name,
    "*.${aws_route53_zone.primary_domain.name}"
  ]

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "primary_domain_cert_validation_records" {
  for_each = {
    for dvo in aws_acm_certificate.primary_domain_cert.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = aws_route53_zone.primary_domain.zone_id
}

resource "aws_ssm_parameter" "primary_domain_cert_arn" {
  name = "primary_domain_cert_arn"
  type = "String"
  value = aws_acm_certificate.primary_domain_cert.arn
  description = "Certificate ARN for primary domain"
}

resource "aws_ssm_parameter" "primary_domain_name" {
  name = "primary_domain_name"
  type = "String"
  value = var.primary_domain
  description = "DNS name of primary domain"
}

# Create S3 Bucket for CDN
resource "aws_s3_bucket" "primary_domain_cdn" {
  bucket = "${aws_route53_zone.primary_domain.name}-cdn"
  force_destroy = true
}

resource "aws_ssm_parameter" "primary_domain_cdn" {
  name = "primary_domain_cdn"
  type = "String"
  value = aws_s3_bucket.primary_domain_cdn.id
  description = "Bucket ID of primary domain CDN"
}

# Allow public access
resource "aws_s3_bucket_ownership_controls" "primary_domain_cdn_ownership_controls" {
  bucket = aws_s3_bucket.primary_domain_cdn.id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}
resource "aws_s3_bucket_public_access_block" "primary_domain_cdn_access_block" {
  bucket = aws_s3_bucket.primary_domain_cdn.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}
resource "aws_s3_bucket_acl" "primary_domain_cdn_acl" {
  depends_on = [
    aws_s3_bucket_ownership_controls.primary_domain_cdn_ownership_controls,
    aws_s3_bucket_public_access_block.primary_domain_cdn_access_block,
  ]

  bucket = aws_s3_bucket.primary_domain_cdn.id
  acl    = "public-read"
}

resource "aws_s3_bucket_website_configuration" "primary_domain_cdn_hosting_config" {
  bucket = aws_s3_bucket.primary_domain_cdn.id

  index_document {
    suffix = "index.html"
  }
}

resource "aws_acm_certificate_validation" "primary_domain_cert_validation" {
  provider = aws.us-east-1
  certificate_arn         = aws_acm_certificate.primary_domain_cert.arn
  validation_record_fqdns = [for record in aws_route53_record.primary_domain_cert_validation_records : record.fqdn]
}

resource "aws_cloudfront_distribution" "primary_domain_cdn_distribution" {
  enabled         = true
  is_ipv6_enabled = true
  depends_on = [ aws_acm_certificate_validation.primary_domain_cert_validation ]
  origin {
    domain_name = aws_s3_bucket_website_configuration.primary_domain_cdn_hosting_config.website_endpoint
    origin_id   = aws_s3_bucket.primary_domain_cdn.bucket_regional_domain_name

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_keepalive_timeout = 5
      origin_protocol_policy   = "http-only"
      origin_read_timeout      = 30
      origin_ssl_protocols = [
        "TLSv1.2",
      ]
    }
  }

  viewer_certificate {
    acm_certificate_arn = aws_acm_certificate.primary_domain_cert.arn
    ssl_support_method = "sni-only"
  }

  aliases = [
    var.primary_domain,
    "www.${var.primary_domain}"
  ]

  restrictions {
    geo_restriction {
      restriction_type = "none"
      locations        = []
    }
  }

  default_cache_behavior {
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = aws_s3_bucket.primary_domain_cdn.bucket_regional_domain_name
  }
}



resource "aws_ssm_parameter" "primary_domain_cdn_distribution" {
  name = "primary_domain_cdn_distribution"
  type = "String"
  value = aws_cloudfront_distribution.primary_domain_cdn_distribution.id
  description = "Distribution ID for primary CDN cloudfront distribution"
}

resource "aws_route53_record" "pimary_domain_cdn_cname" {
    zone_id = aws_route53_zone.primary_domain.id
    name = var.primary_domain
    type = "A"

    alias {
        name = aws_cloudfront_distribution.primary_domain_cdn_distribution.domain_name
        zone_id = aws_cloudfront_distribution.primary_domain_cdn_distribution.hosted_zone_id
        evaluate_target_health = false
    }
}

resource "aws_s3_bucket_policy" "primary_domain_cdn_bucket_policy" {
  bucket = aws_s3_bucket.primary_domain_cdn.id
  depends_on = [ aws_s3_bucket_acl.primary_domain_cdn_acl ]
  policy = jsonencode(
    {
      "Version" : "2012-10-17",
      "Statement" : [
        {
          "Sid" : "PublicReadGetObject",
          "Effect" : "Allow",
          "Principal" : "*",
          "Action" : "s3:GetObject",
          "Resource" : "arn:aws:s3:::${aws_s3_bucket.primary_domain_cdn.id}/*"
        }
      ]
    }
  )
}
