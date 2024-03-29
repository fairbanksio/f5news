# Configure Terraform Cloud settings & providers
terraform {
  cloud {
    organization = "Fairbanks-io"
    workspaces {
      name = "f5-news"
    }
  }

  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
    mongodbatlas = {
      source = "mongodb/mongodbatlas"
    }
  }
  required_version = ">= 0.13"
}

# Configure the AWS provider for the default region
provider "aws" {
  region = "us-east-1"
}

provider "aws" {
  alias  = "us-east-1"
  region = "us-east-1"
}

# Configure the MongoDB Atlas provider
provider "mongodbatlas" {
  public_key  = var.mongodb_atlas_public_key
  private_key = var.mongodb_atlas_private_key
}