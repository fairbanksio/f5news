mock_provider "aws" {
  mock_resource "aws_acm_certificate" {
    override_during = plan
    defaults = {
      id                  = "fixture-certificate"
      key_algorithm       = "RSA_2048"
      region              = "us-east-1"
      not_after           = "2030-01-01T00:00:00Z"
      not_before          = "2026-01-01T00:00:00Z"
      pending_renewal     = false
      renewal_eligibility = "ELIGIBLE"
      renewal_summary     = []
      status              = "ISSUED"
      type                = "AMAZON_ISSUED"
      tags_all            = {}
      validation_emails   = []
      arn                 = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
      domain_validation_options = [{
        domain_name           = "example.test"
        resource_record_name  = "_validation.example.test"
        resource_record_value = "_validation.acm-validations.aws"
        resource_record_type  = "CNAME"
      }]
    }
  }
}
mock_provider "aws" {
  alias = "us-east-1"
  mock_resource "aws_acm_certificate" {
    override_during = plan
    defaults = {
      id                  = "fixture-certificate"
      key_algorithm       = "RSA_2048"
      region              = "us-east-1"
      not_after           = "2030-01-01T00:00:00Z"
      not_before          = "2026-01-01T00:00:00Z"
      pending_renewal     = false
      renewal_eligibility = "ELIGIBLE"
      renewal_summary     = []
      status              = "ISSUED"
      type                = "AMAZON_ISSUED"
      tags_all            = {}
      validation_emails   = []
      arn                 = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
      domain_validation_options = [{
        domain_name           = "example.test"
        resource_record_name  = "_validation.example.test"
        resource_record_value = "_validation.acm-validations.aws"
        resource_record_type  = "CNAME"
      }]
    }
  }
}
mock_provider "mongodbatlas" {
  mock_resource "mongodbatlas_cluster" {
    defaults = {
      connection_strings = [{ standard_srv = "mongodb+srv://fixture.example.test" }]
    }
  }
}
mock_provider "random" {
}

variables {
  primary_domain            = "example.test"
  mongodb_atlas_public_key  = "fixture-public"
  mongodb_atlas_private_key = "fixture-private"
  mongodb_atlas_org_id      = "fixture-org"
  reddit_client_id          = "fixture-client"
  reddit_secret_key         = "fixture-secret"
  reddit_username           = "fixture-user"
  reddit_password           = "fixture-password"
}

run "private_cdn" {
  # Apply only to mocked providers; no cloud resources or persistent state are used.
  command = apply

  assert {
    condition = (
      aws_s3_bucket_public_access_block.primary_domain_cdn_access_block.block_public_acls &&
      aws_s3_bucket_public_access_block.primary_domain_cdn_access_block.block_public_policy &&
      aws_s3_bucket_public_access_block.primary_domain_cdn_access_block.ignore_public_acls &&
      aws_s3_bucket_public_access_block.primary_domain_cdn_access_block.restrict_public_buckets &&
      aws_s3_bucket_acl.primary_domain_cdn_acl.acl == "private"
    )
    error_message = "The CDN bucket must block public access and replace its public ACL."
  }

  assert {
    condition = (
      aws_cloudfront_origin_access_control.primary_domain_cdn.signing_behavior == "always" &&
      aws_cloudfront_origin_access_control.primary_domain_cdn.signing_protocol == "sigv4" &&
      one(aws_cloudfront_distribution.primary_domain_cdn_distribution.origin).origin_access_control_id == aws_cloudfront_origin_access_control.primary_domain_cdn.id &&
      one(aws_cloudfront_distribution.primary_domain_cdn_distribution.origin).domain_name == aws_s3_bucket.primary_domain_cdn.bucket_regional_domain_name
    )
    error_message = "CloudFront must sign requests to the S3 REST origin."
  }

  assert {
    condition = (
      jsondecode(aws_s3_bucket_policy.primary_domain_cdn_bucket_policy.policy).Statement[0].Principal.Service == "cloudfront.amazonaws.com" &&
      jsondecode(aws_s3_bucket_policy.primary_domain_cdn_bucket_policy.policy).Statement[0].Action == "s3:GetObject" &&
      jsondecode(aws_s3_bucket_policy.primary_domain_cdn_bucket_policy.policy).Statement[0].Condition.StringEquals["AWS:SourceArn"] == aws_cloudfront_distribution.primary_domain_cdn_distribution.arn
    )
    error_message = "Only this CloudFront distribution should receive bucket-policy read access."
  }

  assert {
    condition = (
      aws_cloudfront_distribution.primary_domain_cdn_distribution.default_root_object == "index.html" &&
      toset([for response in aws_cloudfront_distribution.primary_domain_cdn_distribution.custom_error_response : response.error_code]) == toset([403, 404]) &&
      alltrue([for response in aws_cloudfront_distribution.primary_domain_cdn_distribution.custom_error_response : response.response_code == 200 && response.response_page_path == "/index.html"])
    )
    error_message = "Private-origin missing objects must preserve SPA deep links."
  }

  assert {
    condition = (
      aws_route53_record.pimary_domain_cdn_cname.name == "example.test" &&
      aws_route53_record.pimary_domain_cdn_cname.type == "A" &&
      aws_route53_record.primary_domain_cdn_aliases["www_a"].name == "www.example.test" &&
      aws_route53_record.primary_domain_cdn_aliases["www_a"].type == "A" &&
      aws_route53_record.primary_domain_cdn_aliases["apex_aaaa"].type == "AAAA" &&
      aws_route53_record.primary_domain_cdn_aliases["www_aaaa"].type == "AAAA"
    )
    error_message = "Both advertised hostnames need IPv4 and IPv6 aliases."
  }

  assert {
    condition     = aws_cloudfront_distribution.primary_domain_cdn_distribution.default_cache_behavior[0].response_headers_policy_id == "67f7725c-6f97-4210-82d7-5512b31e9d03"
    error_message = "Use AWS managed SecurityHeadersPolicy."
  }
}
