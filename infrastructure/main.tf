# Create Route53 hosted zone for the primary domain
resource "aws_route53_zone" "primary_domain" {
  name = var.primary_domain
}

# Create ACM certificate for the primary domain
resource "aws_acm_certificate" "primary_domain_cert" {
  provider          = aws.us-east-1
  domain_name       = aws_route53_zone.primary_domain.name
  validation_method = "DNS"
  subject_alternative_names = [
    aws_route53_zone.primary_domain.name,
    "*.${aws_route53_zone.primary_domain.name}"
  ]

  lifecycle {
    create_before_destroy = true
  }
}

# Create Route53 records for ACM certificate validation
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

# Store ACM certificate ARN in SSM Parameter Store
resource "aws_ssm_parameter" "primary_domain_cert_arn" {
  name        = "primary_domain_cert_arn"
  type        = "String"
  value       = aws_acm_certificate.primary_domain_cert.arn
  description = "Certificate ARN for primary domain"
}

# Store primary domain name in SSM Parameter Store
resource "aws_ssm_parameter" "primary_domain_name" {
  name        = "primary_domain_name"
  type        = "String"
  value       = var.primary_domain
  description = "DNS name of primary domain"
}

# Create S3 Bucket for CDN
resource "aws_s3_bucket" "primary_domain_cdn" {
  bucket        = "${aws_route53_zone.primary_domain.name}-client-cdn"
  force_destroy = true
}

# Store S3 Bucket ID of CDN in SSM Parameter Store
resource "aws_ssm_parameter" "primary_domain_cdn" {
  name        = "primary_domain_cdn"
  type        = "String"
  value       = aws_s3_bucket.primary_domain_cdn.id
  description = "Bucket ID of primary domain CDN"
}

# Keep existing ACL ownership while migrating the bucket to private access.
resource "aws_s3_bucket_ownership_controls" "primary_domain_cdn_ownership_controls" {
  bucket = aws_s3_bucket.primary_domain_cdn.id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

# Configure public access block settings for the S3 Bucket
resource "aws_s3_bucket_public_access_block" "primary_domain_cdn_access_block" {
  bucket = aws_s3_bucket.primary_domain_cdn.id

  # Tighten access after CloudFront has switched to its signed REST origin.
  depends_on = [aws_s3_bucket_policy.primary_domain_cdn_bucket_policy]

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Reset the existing public ACL without changing object ownership.
resource "aws_s3_bucket_acl" "primary_domain_cdn_acl" {
  depends_on = [
    aws_s3_bucket_ownership_controls.primary_domain_cdn_ownership_controls,
    aws_s3_bucket_public_access_block.primary_domain_cdn_access_block,
  ]

  bucket = aws_s3_bucket.primary_domain_cdn.id
  acl    = "private"
}

# Retain website settings during the origin migration; public access is blocked.
resource "aws_s3_bucket_website_configuration" "primary_domain_cdn_hosting_config" {
  bucket = aws_s3_bucket.primary_domain_cdn.id

  index_document {
    suffix = "index.html"
  }
}

# Validate ACM certificate
resource "aws_acm_certificate_validation" "primary_domain_cert_validation" {
  provider                = aws.us-east-1
  certificate_arn         = aws_acm_certificate.primary_domain_cert.arn
  validation_record_fqdns = [for record in aws_route53_record.primary_domain_cert_validation_records : record.fqdn]
}

# Sign CloudFront requests to the private S3 REST origin.
resource "aws_cloudfront_origin_access_control" "primary_domain_cdn" {
  name                              = "${var.primary_domain}-cdn"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Create CloudFront distribution for the CDN
resource "aws_cloudfront_distribution" "primary_domain_cdn_distribution" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  depends_on          = [aws_acm_certificate_validation.primary_domain_cert_validation]
  origin {
    domain_name              = aws_s3_bucket.primary_domain_cdn.bucket_regional_domain_name
    origin_id                = aws_s3_bucket.primary_domain_cdn.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.primary_domain_cdn.id

    s3_origin_config {
      origin_access_identity = ""
    }
  }

  viewer_certificate {
    acm_certificate_arn = aws_acm_certificate.primary_domain_cert.arn
    ssl_support_method  = "sni-only"
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
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    # AWS managed SecurityHeadersPolicy; this policy does not include CSP.
    response_headers_policy_id = "67f7725c-6f97-4210-82d7-5512b31e9d03"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = aws_s3_bucket.primary_domain_cdn.bucket_regional_domain_name
  }
  # S3 returns 403 for missing keys without ListBucket permission.
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

}

# Store CloudFront distribution ID in SSM Parameter Store
resource "aws_ssm_parameter" "primary_domain_cdn_distribution" {
  name        = "primary_domain_cdn_distribution"
  type        = "String"
  value       = aws_cloudfront_distribution.primary_domain_cdn_distribution.id
  description = "Distribution ID for primary CDN cloudfront distribution"
}

# Create Route53 record for the CloudFront distribution
resource "aws_route53_record" "pimary_domain_cdn_cname" {
  zone_id = aws_route53_zone.primary_domain.id
  name    = var.primary_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.primary_domain_cdn_distribution.domain_name
    zone_id                = aws_cloudfront_distribution.primary_domain_cdn_distribution.hosted_zone_id
    evaluate_target_health = false
  }
}

# Add aliases without changing the existing apex A resource address.
resource "aws_route53_record" "primary_domain_cdn_aliases" {
  for_each = {
    www_a     = { name = "www.${var.primary_domain}", type = "A" }
    apex_aaaa = { name = var.primary_domain, type = "AAAA" }
    www_aaaa  = { name = "www.${var.primary_domain}", type = "AAAA" }
  }

  zone_id = aws_route53_zone.primary_domain.id
  name    = each.value.name
  type    = each.value.type

  alias {
    name                   = aws_cloudfront_distribution.primary_domain_cdn_distribution.domain_name
    zone_id                = aws_cloudfront_distribution.primary_domain_cdn_distribution.hosted_zone_id
    evaluate_target_health = false
  }
}

# Replace public access after CloudFront deploys its signed REST origin.
resource "aws_s3_bucket_policy" "primary_domain_cdn_bucket_policy" {
  bucket = aws_s3_bucket.primary_domain_cdn.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontReadOnly"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.primary_domain_cdn.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.primary_domain_cdn_distribution.arn
        }
      }
    }]
  })
}

# Store Reddit app details in SSM Parameter Store
resource "aws_ssm_parameter" "reddit_client_id" {
  name        = "reddit_client_id"
  type        = "SecureString"
  value       = var.reddit_client_id
  description = "Reddit app client ID"
}

resource "aws_ssm_parameter" "reddit_secret_key" {
  name        = "reddit_secret_key"
  type        = "SecureString"
  value       = var.reddit_secret_key
  description = "Reddit app secret key"
}

resource "aws_ssm_parameter" "reddit_username" {
  name        = "reddit_username"
  type        = "SecureString"
  value       = var.reddit_username
  description = "Username tied to the Reddit app developer account"
}

resource "aws_ssm_parameter" "reddit_password" {
  name        = "reddit_password"
  type        = "SecureString"
  value       = var.reddit_password
  description = "Password for Reddit app developer account"
}
