mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "633025216388" }
  }
  mock_resource "aws_s3_bucket" {
    override_during = plan
    defaults = {
      id  = "f5-news-reddit-session-633025216388"
      arn = "arn:aws:s3:::f5-news-reddit-session-633025216388"
    }
  }
}

mock_provider "aws" {
  alias = "us-east-1"
}

mock_provider "mongodbatlas" {}

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

run "private_shared_browser_session" {
  command = plan
  plan_options {
    target = [
      aws_s3_bucket.reddit_session,
      aws_s3_bucket_public_access_block.reddit_session,
      aws_s3_bucket_ownership_controls.reddit_session,
      aws_s3_bucket_server_side_encryption_configuration.reddit_session,
      aws_s3_bucket_lifecycle_configuration.reddit_session,
      aws_s3_bucket_policy.reddit_session,
      aws_ssm_parameter.reddit_session_bucket,
    ]
  }

  assert {
    condition = (
      aws_s3_bucket.reddit_session.bucket == "f5-news-reddit-session-633025216388" &&
      aws_s3_bucket_public_access_block.reddit_session.block_public_acls &&
      aws_s3_bucket_public_access_block.reddit_session.block_public_policy &&
      aws_s3_bucket_public_access_block.reddit_session.ignore_public_acls &&
      aws_s3_bucket_public_access_block.reddit_session.restrict_public_buckets &&
      aws_s3_bucket_ownership_controls.reddit_session.rule[0].object_ownership == "BucketOwnerEnforced"
    )
    error_message = "Session cookies must stay in a dedicated private bucket with ACLs disabled."
  }

  assert {
    condition     = one(aws_s3_bucket_server_side_encryption_configuration.reddit_session.rule).apply_server_side_encryption_by_default[0].sse_algorithm == "AES256"
    error_message = "Session objects must use SSE-S3 encryption by default."
  }

  assert {
    condition = (
      length(jsondecode(aws_s3_bucket_policy.reddit_session.policy).Statement) == 1 &&
      jsondecode(aws_s3_bucket_policy.reddit_session.policy).Statement[0].Effect == "Deny" &&
      jsondecode(aws_s3_bucket_policy.reddit_session.policy).Statement[0].Principal == "*" &&
      jsondecode(aws_s3_bucket_policy.reddit_session.policy).Statement[0].Action == "s3:*" &&
      jsondecode(aws_s3_bucket_policy.reddit_session.policy).Statement[0].Condition.Bool["aws:SecureTransport"] == "false" &&
      toset(jsondecode(aws_s3_bucket_policy.reddit_session.policy).Statement[0].Resource) == toset([
        "arn:aws:s3:::f5-news-reddit-session-633025216388",
        "arn:aws:s3:::f5-news-reddit-session-633025216388/*",
      ])
    )
    error_message = "The bucket policy must deny all unencrypted transport without granting public access."
  }

  assert {
    condition = (
      aws_s3_bucket_lifecycle_configuration.reddit_session.rule[0].status == "Enabled" &&
      aws_s3_bucket_lifecycle_configuration.reddit_session.rule[0].filter[0].prefix == "reddit/sessions/" &&
      aws_s3_bucket_lifecycle_configuration.reddit_session.rule[0].expiration[0].days == 7 &&
      aws_s3_bucket_lifecycle_configuration.reddit_session.rule[0].abort_incomplete_multipart_upload[0].days_after_initiation == 1
    )
    error_message = "Immutable session objects must expire after seven days and incomplete uploads after one day."
  }

  assert {
    condition = (
      aws_ssm_parameter.reddit_session_bucket.name == "/f5_reddit_session_bucket" &&
      aws_ssm_parameter.reddit_session_bucket.type == "String" &&
      nonsensitive(aws_ssm_parameter.reddit_session_bucket.value) == aws_s3_bucket.reddit_session.bucket
    )
    error_message = "SSM should expose only the bucket name, never session contents."
  }
}
