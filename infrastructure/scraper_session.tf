resource "aws_s3_bucket" "reddit_session" {
  bucket = "f5-news-reddit-session-${data.aws_caller_identity.scraper_image.account_id}"
}

resource "aws_s3_bucket_public_access_block" "reddit_session" {
  bucket                  = aws_s3_bucket.reddit_session.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "reddit_session" {
  bucket = aws_s3_bucket.reddit_session.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "reddit_session" {
  bucket = aws_s3_bucket.reddit_session.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "reddit_session" {
  bucket = aws_s3_bucket.reddit_session.id
  rule {
    id     = "ExpireSessionObjects"
    status = "Enabled"
    filter {
      prefix = "reddit/sessions/"
    }
    expiration {
      days = 7
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_policy" "reddit_session" {
  bucket = aws_s3_bucket.reddit_session.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "RequireTLS"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.reddit_session.arn, "${aws_s3_bucket.reddit_session.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.reddit_session]
}

resource "aws_ssm_parameter" "reddit_session_bucket" {
  name        = "/f5_reddit_session_bucket"
  description = "Private bucket for the scraper's shared Reddit browser session"
  type        = "String"
  value       = aws_s3_bucket.reddit_session.bucket
}
