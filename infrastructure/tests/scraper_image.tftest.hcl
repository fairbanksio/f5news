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
      length(jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement) == 7 &&
      alltrue([for statement in jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement : statement.Effect == "Allow"]) &&
      alltrue([for statement in jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement : statement.Resource != ["*"] || statement.Action == ["ecr:GetAuthorizationToken"] || statement.Action == ["logs:DescribeLogGroups"]])
    )
    error_message = "Only registry authentication and log-group discovery may use wildcard resources."
  }

  assert {
    condition = (
      jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement[2].Action == ["lambda:InvokeFunction"] &&
      jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement[2].Resource == ["arn:aws:lambda:us-east-1:633025216388:function:scraper-dev-fetchPosts-browser"]
    )
    error_message = "The deployment probe must only invoke the new browser scraper function."
  }

  assert {
    condition = (
      toset(jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement[3].Action) == toset([
        "lambda:CreateFunction", "lambda:DeleteFunction", "lambda:GetFunction",
        "lambda:GetFunctionConfiguration", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
        "lambda:PublishVersion", "lambda:ListVersionsByFunction", "lambda:GetPolicy",
        "lambda:AddPermission", "lambda:RemovePermission", "lambda:TagResource",
        "lambda:UntagResource", "lambda:ListTags", "lambda:GetFunctionEventInvokeConfig",
        "lambda:PutFunctionEventInvokeConfig", "lambda:UpdateFunctionEventInvokeConfig",
        "lambda:DeleteFunctionEventInvokeConfig", "lambda:ListFunctionEventInvokeConfigs",
        "lambda:GetFunctionCodeSigningConfig", "lambda:GetRuntimeManagementConfig",
        "lambda:GetFunctionConcurrency", "lambda:GetProvisionedConcurrencyConfig",
        "lambda:ListProvisionedConcurrencyConfigs",
      ]) &&
      toset(jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement[3].Resource) == toset([
        "arn:aws:lambda:us-east-1:633025216388:function:scraper-dev-fetchPosts-browser",
        "arn:aws:lambda:us-east-1:633025216388:function:scraper-dev-fetchPosts-browser:*",
      ])
    )
    error_message = "CloudFormation lifecycle access must be limited to the browser function and its qualified versions."
  }

  assert {
    condition = (
      toset(jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement[4].Action) == toset([
        "logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:PutRetentionPolicy",
        "logs:DeleteRetentionPolicy", "logs:TagResource", "logs:UntagResource",
        "logs:ListTagsForResource", "logs:TagLogGroup", "logs:UntagLogGroup", "logs:ListTagsLogGroup",
      ]) &&
      toset(jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement[5].Action) == toset([
        "logs:DescribeLogStreams", "logs:FilterLogEvents", "logs:GetLogEvents",
      ]) &&
      alltrue([for statement in slice(jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement, 4, 6) : toset(statement.Resource) == toset([
        "arn:aws:logs:us-east-1:633025216388:log-group:/aws/lambda/scraper-dev-fetchPosts-browser",
        "arn:aws:logs:us-east-1:633025216388:log-group:/aws/lambda/scraper-dev-fetchPosts-browser:*",
      ])])
    )
    error_message = "Log lifecycle and diagnostics must stay limited to the browser log group and its streams."
  }

  assert {
    condition = (
      jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement[6].Action == ["logs:DescribeLogGroups"] &&
      jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement[6].Resource == ["*"] &&
      jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement[6].Condition.StringEquals["aws:RequestedRegion"] == "us-east-1"
    )
    error_message = "Log-group discovery must only grant regional metadata access required by CloudFormation."
  }

  assert {
    condition = alltrue(flatten([
      for statement in jsondecode(aws_iam_role_policy.scraper_image_deploy.policy).Statement : [
        for action in statement.Action : !startswith(action, "iam:") && !strcontains(action, "*")
      ]
    ]))
    error_message = "The policy must not grant IAM management or wildcard actions."
  }
}
