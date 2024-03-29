# AWS

variable "primary_domain" {
  type        = string
  description = "Primary DNS Zone"
}

# Mongo Variables

variable "mongodb_atlas_public_key" {
  type        = string
  description = "MongoDB Atlas API Public Key"
}

variable "mongodb_atlas_private_key" {
  type        = string
  description = "MongoDB Atlas API Private Key"
}

variable "mongodb_atlas_org_id" {
  type        = string
  description = "MongoDB Atlas Organization ID"
}

# Reddit Variables

variable "reddit_client_id" {
  type        = string
  description = "Reddit App Client ID"
}

variable "reddit_secret_key" {
  type        = string
  description = "Reddit App Secret Key"
}

variable "reddit_username" {
  type        = string
  description = "Username for Reddit Developer Account"
}

variable "reddit_password" {
  type        = string
  description = "Password for Reddit Developer Account"
}