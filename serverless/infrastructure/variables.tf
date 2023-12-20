
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