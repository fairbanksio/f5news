mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "633025216388" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
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

run "scoped_scraper_image_permissions" {
  command = plan

  plan_options {
    target = [aws_iam_role_policy.scraper_image_deploy]
  }

  assert {
    condition = (
      aws_iam_role_policy.scraper_image_deploy.role == "GithubActions-Fairbanksio-F5oclock" &&
      aws_iam_role_policy.scraper_image_deploy.name == "F5BrowserScraperImage"
    )
    error_message = "Only the existing F5 deployment role should receive this separate inline policy."
  }

  assert {
    condition = (
      toset(jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement[0].Action) == toset([
        "ecr:DescribeRepositories", "ecr:CreateRepository", "ecr:DescribeImages",
        "ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer", "ecr:GetRepositoryPolicy", "ecr:SetRepositoryPolicy",
      ]) &&
      jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement[0].Resource == ["arn:aws:ecr:us-east-1:633025216388:repository/serverless-scraper-dev"]
    )
    error_message = "Image creation, publishing, metadata reads, and Lambda pull-policy access must stay scoped to the scraper repository."
  }

  assert {
    condition = (
      jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement[1].Action == ["ecr:GetAuthorizationToken"] &&
      jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement[1].Resource == ["*"] &&
      jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement[1].Condition.StringEquals["aws:RequestedRegion"] == "us-east-1" &&
      length(jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement) == 3 &&
      alltrue([for statement in jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement : statement.Effect == "Allow"]) &&
      alltrue([for statement in jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement : statement.Resource != ["*"] || statement.Action == ["ecr:GetAuthorizationToken"]])
    )
    error_message = "Registry authentication is the only wildcard resource permission and must remain in us-east-1."
  }

  assert {
    condition = (
      jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement[2].Action == ["lambda:InvokeFunction"] &&
      jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement[2].Resource == ["arn:aws:lambda:us-east-1:633025216388:function:scraper-dev-fetchPosts-browser"]
    )
    error_message = "The deployment probe must only invoke the new browser scraper function."
  }
}
