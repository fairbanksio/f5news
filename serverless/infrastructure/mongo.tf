locals  {
    project_name = "f5-news"
    whitelisted_ips = "0.0.0.0/0"
    environment = "dev"
    mongodb_version = "6.0"
    cluster_instance_size_name = "M0"
    provider_name = "TENANT"
    backing_provider_name = "AWS"
    atlas_region = "US_WEST_2"
}

resource "mongodbatlas_project" "atlas-project" {
  org_id = var.mongodb_atlas_org_id
  name = local.project_name
}

# Create a Database Password
resource "random_password" "db-user-password" {
  length = 16
  special = true
  override_special = "^&*"
}

resource "mongodbatlas_database_user" "db-user" {
  username = "user-1"
  password = random_password.db-user-password.result
  project_id = mongodbatlas_project.atlas-project.id
  auth_database_name = "admin"
  roles {
    role_name     = "readWrite"
    database_name = "${local.project_name}-db"
  }
}

resource "mongodbatlas_project_ip_access_list" "ip" {
  project_id = mongodbatlas_project.atlas-project.id
  cidr_block = local.whitelisted_ips
}

resource "mongodbatlas_cluster" "atlas_cluster" {
  project_id   = mongodbatlas_project.atlas-project.id
  name         = "${local.project_name}-${local.environment}-cluster"
  cluster_type = "REPLICASET"

  mongo_db_major_version       = local.mongodb_version
  
  # Provider Settings "block"
  provider_region_name = local.atlas_region
  provider_name               = local.provider_name
  backing_provider_name = local.backing_provider_name
  provider_instance_size_name = local.cluster_instance_size_name

}


resource "aws_ssm_parameter" "primary_db_connection_string" {
  name = "primary_db_connection_string"
  type = "SecureString"
  value = "${replace(mongodbatlas_cluster.atlas_cluster.connection_strings[0].standard_srv, "mongodb+srv://", "mongodb+srv://${mongodbatlas_database_user.db-user.username}:${coalesce(nonsensitive(mongodbatlas_database_user.db-user.password), "null")}@")}/${local.project_name}-db"
  description = "Connection String for primary mongo db"
}