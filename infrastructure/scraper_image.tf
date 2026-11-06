data "aws_caller_identity" "scraper_image" {}

data "aws_partition" "scraper_image" {}

locals {
  scraper_image_repository_arn  = "arn:${data.aws_partition.scraper_image.partition}:ecr:us-east-1:${data.aws_caller_identity.scraper_image.account_id}:repository/serverless-scraper-dev"
  scraper_browser_function_arn  = "arn:${data.aws_partition.scraper_image.partition}:lambda:us-east-1:${data.aws_caller_identity.scraper_image.account_id}:function:scraper-dev-fetchPosts-browser"
  scraper_browser_log_group_arn = "arn:${data.aws_partition.scraper_image.partition}:logs:us-east-1:${data.aws_caller_identity.scraper_image.account_id}:log-group:/aws/lambda/scraper-dev-fetchPosts-browser"
  scraper_legacy_function_arn   = trimsuffix(local.scraper_browser_function_arn, "-browser")
}

# Extend the existing deployment role without taking ownership of its other policies.
resource "aws_iam_role_policy" "scraper_image_deploy" {
  name = "F5BrowserScraperImage"
  role = "GithubActions-Fairbanksio-F5oclock"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ScraperImageRepository"
        Effect = "Allow"
        Action = [
          "ecr:DescribeRepositories",
          "ecr:CreateRepository",
          "ecr:DescribeImages",
          "ecr:BatchCheckLayerAvailability",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:GetRepositoryPolicy",
          "ecr:SetRepositoryPolicy",
        ]
        Resource = [local.scraper_image_repository_arn]
      },
      {
        Sid      = "ScraperRegistryAuthentication"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = ["*"]
        Condition = {
          StringEquals = { "aws:RequestedRegion" = "us-east-1" }
        }
      },
      {
        Sid      = "ScraperDeploymentProbe"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = [local.scraper_browser_function_arn]
      },
      {
        Sid    = "ScraperFunctionLifecycle"
        Effect = "Allow"
        Action = [
          "lambda:CreateFunction",
          "lambda:DeleteFunction",
          "lambda:GetFunction",
          "lambda:GetFunctionConfiguration",
          "lambda:UpdateFunctionCode",
          "lambda:UpdateFunctionConfiguration",
          "lambda:PublishVersion",
          "lambda:ListVersionsByFunction",
          "lambda:GetPolicy",
          "lambda:AddPermission",
          "lambda:RemovePermission",
          "lambda:TagResource",
          "lambda:UntagResource",
          "lambda:ListTags",
          "lambda:GetFunctionEventInvokeConfig",
          "lambda:PutFunctionEventInvokeConfig",
          "lambda:UpdateFunctionEventInvokeConfig",
          "lambda:DeleteFunctionEventInvokeConfig",
          "lambda:ListFunctionEventInvokeConfigs",
          "lambda:GetFunctionCodeSigningConfig",
          "lambda:GetRuntimeManagementConfig",
          "lambda:GetFunctionConcurrency",
          "lambda:GetProvisionedConcurrencyConfig",
          "lambda:ListProvisionedConcurrencyConfigs",
        ]
        Resource = [local.scraper_browser_function_arn, "${local.scraper_browser_function_arn}:*"]
      },
      {
        Sid    = "ScraperLogGroupLifecycle"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:DeleteLogGroup",
          "logs:PutRetentionPolicy",
          "logs:DeleteRetentionPolicy",
          "logs:TagResource",
          "logs:UntagResource",
          "logs:ListTagsForResource",
          "logs:TagLogGroup",
          "logs:UntagLogGroup",
          "logs:ListTagsLogGroup",
        ]
        Resource = [local.scraper_browser_log_group_arn, "${local.scraper_browser_log_group_arn}:*"]
      },
      {
        Sid      = "ScraperLogDiagnostics"
        Effect   = "Allow"
        Action   = ["logs:DescribeLogStreams", "logs:FilterLogEvents", "logs:GetLogEvents"]
        Resource = [local.scraper_browser_log_group_arn, "${local.scraper_browser_log_group_arn}:*"]
      },
      {
        # CloudFormation reads log groups through this regional discovery API.
        Sid      = "ScraperLogGroupDiscovery"
        Effect   = "Allow"
        Action   = ["logs:DescribeLogGroups"]
        Resource = ["*"]
        Condition = {
          StringEquals = { "aws:RequestedRegion" = "us-east-1" }
        }
      },
      {
        Sid      = "ScraperLegacyFunctionRetirement"
        Effect   = "Allow"
        Action   = ["lambda:DeleteFunction"]
        Resource = [local.scraper_legacy_function_arn, "${local.scraper_legacy_function_arn}:*"]
      },
    ]
  })
}
