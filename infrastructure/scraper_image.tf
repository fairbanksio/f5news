data "aws_caller_identity" "scraper_image" {}

data "aws_partition" "scraper_image" {}

locals {
  scraper_image_repository_arn = "arn:${data.aws_partition.scraper_image.partition}:ecr:us-east-1:${data.aws_caller_identity.scraper_image.account_id}:repository/serverless-scraper-dev"
  scraper_browser_function_arn = "arn:${data.aws_partition.scraper_image.partition}:lambda:us-east-1:${data.aws_caller_identity.scraper_image.account_id}:function:scraper-dev-fetchPosts-browser"
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
    ]
  })
}
