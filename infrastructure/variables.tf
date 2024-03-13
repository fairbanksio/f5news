
variable "primary_domain" {
  type        = string
  description = "Primary DNS Zone that gets created"
}

variable "mongodb_atlas_public_key" {
  type        = string
  description = "MongoDB Atlas api public key"
}

variable "mongodb_atlas_private_key" {
  type        = string
  description = "MongoDB Atlas api private key"
}

variable "mongodb_atlas_org_id" {
  type        = string
  description = "MongoDB Atlas Organization ID"
}

variable "reddit_client_id" {
  type        = string
  description = "Reddit app client id"
}

variable "reddit_secret_key" {
  type        = string
  description = "Reddit app secret key"
}

variable "reddit_username" {
  type        = string
  description = "reddit username of developer of reddit app"
}

variable "reddit_password" {
  type        = string
  description = "reddit password of developer of reddit app"
}