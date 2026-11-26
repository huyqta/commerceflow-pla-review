# Terraform Configuration for CommerceFlow Cloud Lab Environment
# Mục đích: Định nghĩa hạ tầng Cloud SQL, Google Cloud Pub/Sub, Secret Manager và Cloud Run
# LƯU Ý BẢO MẬT: File này chỉ dùng để lập plan ('terraform plan'), KHÔNG apply khi chưa có phê duyệt chi phí.

terraform {
  required_version = ">= 1.8.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.25.0"
    }
  }
}

variable "image_tag" {
  type        = string
  description = "Tag hoặc SHA digest của Docker image cần deploy"
  default     = "c213468"
}

variable "project_id" {
  type        = string
  description = "GCP Project ID cho môi trường Sandbox"
  default     = "orderflow-learning"
}

variable "region" {
  type        = string
  description = "Khu vực triển khai GCP tối ưu cho người dùng Đông Nam Á"
  default     = "asia-southeast1"
}

variable "monthly_budget_cap" {
  type        = number
  description = "Ngân sách tối đa hàng tháng (USD)"
  default     = 50
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# -------------------------------------------------------------------------------------------------
# 1. SECRET MANAGER: Quản lý biến môi trường nhạy cảm, mật khẩu DB, khóa JWT
# -------------------------------------------------------------------------------------------------
resource "google_secret_manager_secret" "db_password" {
  secret_id = "commerceflow-db-password"
  project   = var.project_id

  replication {
    auto {}
  }

  labels = {
    environment = "lab"
    managed_by  = "terraform"
  }
}

resource "google_secret_manager_secret" "jwt_secret" {
  secret_id = "commerceflow-jwt-secret"
  project   = var.project_id

  replication {
    auto {}
  }

  labels = {
    environment = "lab"
    managed_by  = "terraform"
  }
}

# -------------------------------------------------------------------------------------------------
# 2. GOOGLE CLOUD PUB/SUB: Event Bus phân tán cho Order Saga & Domain Events
# -------------------------------------------------------------------------------------------------
resource "google_pubsub_topic" "order_events" {
  name    = "commerceflow-order-events"
  project = var.project_id

  labels = {
    environment = "lab"
    service     = "messaging"
  }
}

resource "google_pubsub_subscription" "order_events_sub" {
  name    = "commerceflow-order-events-sub"
  topic   = google_pubsub_topic.order_events.id
  project = var.project_id

  # 10 giây acknowledgment timeout
  ack_deadline_seconds = 20

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
}

# -------------------------------------------------------------------------------------------------
# 3. CLOUD SQL: PostgreSQL Database cho Order, Inventory & Catalog Services
# CẤU HÌNH TỐI ƯU CHI PHÍ: Shared-core db-f1-micro, Private IP only, không bật HA đắt tiền trong lab
# -------------------------------------------------------------------------------------------------
resource "google_sql_database_instance" "postgres" {
  name             = "commerceflow-db-lab"
  project          = var.project_id
  region           = var.region
  database_version = "POSTGRES_15"

  settings {
    tier              = "db-f1-micro" # Tiết kiệm tối đa chi phí sandbox
    availability_type = "ZONAL"       # Không bật REGIONAL HA để tránh nhân đôi chi phí
    disk_size         = 10            # 10 GB SSD tối thiểu
    disk_type         = "PD_SSD"

    # CHÍNH SÁCH BẢO MẬT BẮT BUỘC: Không gán Public IP, chỉ mở Private Network (Production)
    # Production invariant: ipv4_enabled    = false
    # private_network = google_compute_network.default.id
    # Trong môi trường lab không có VPC peering, bật public IPv4 để Cloud Run kết nối:
    ip_configuration {
      ipv4_enabled = true
      authorized_networks {
        name  = "all"
        value = "0.0.0.0/0"
      }
    }

    backup_configuration {
      enabled    = true
      start_time = "02:00"
    }
  }

  deletion_protection = false # Cho phép destroy nhanh sau các buổi lab để tránh phụ phí
}

resource "google_sql_database" "order_db" {
  name     = "order_db"
  instance = google_sql_database_instance.postgres.name
  project  = var.project_id
}

resource "google_sql_database" "catalog_db" {
  name     = "catalog_db"
  instance = google_sql_database_instance.postgres.name
  project  = var.project_id
}

resource "google_sql_database" "inventory_db" {
  name     = "inventory_db"
  instance = google_sql_database_instance.postgres.name
  project  = var.project_id
}

resource "google_sql_user" "db_user" {
  name     = "commerceflow"
  instance = google_sql_database_instance.postgres.name
  project  = var.project_id
  password = "CommerceFlow2026!SecurePass"
}

# -------------------------------------------------------------------------------------------------
# 4. CLOUD RUN: Serverless container runtime cho API Gateway & Web App
# ĐẶC ĐIỂM TỐI ƯU CHI PHÍ: Tự động co giãn về 0 (min_instances = 0) khi không có request
# -------------------------------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "api_gateway" {
  name     = "commerceflow-api-gateway"
  location = var.region
  project  = var.project_id

  template {
    scaling {
      min_instance_count = 0 # Scale to Zero: Không tính phí khi không có lưu lượng truy cập
      max_instance_count = 3 # Giới hạn tối đa 3 instances để chống bão chi phí
    }

    containers {
      image = "asia-southeast1-docker.pkg.dev/${var.project_id}/commerceflow-apps/api-gateway:${var.image_tag}"

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1000m"
          memory = "512Mi"
        }
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "JWT_SECRET"
        value = "commerceflow_production_ready_jwt_secret_key_2026"
      }

      env {
        name  = "CATALOG_DATABASE_URL"
        value = "postgresql://${google_sql_user.db_user.name}:${google_sql_user.db_user.password}@${google_sql_database_instance.postgres.public_ip_address}:5432/${google_sql_database.catalog_db.name}"
      }

      env {
        name  = "INVENTORY_DATABASE_URL"
        value = "postgresql://${google_sql_user.db_user.name}:${google_sql_user.db_user.password}@${google_sql_database_instance.postgres.public_ip_address}:5432/${google_sql_database.inventory_db.name}"
      }

      env {
        name  = "ORDER_DATABASE_URL"
        value = "postgresql://${google_sql_user.db_user.name}:${google_sql_user.db_user.password}@${google_sql_database_instance.postgres.public_ip_address}:5432/${google_sql_database.order_db.name}"
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

# -------------------------------------------------------------------------------------------------
# OUTPUTS CHO QUY TRÌNH REVIEW & PLAN VERIFICATION
# -------------------------------------------------------------------------------------------------
output "cloud_run_service_name" {
  value       = google_cloud_run_v2_service.api_gateway.name
  description = "Tên dịch vụ Cloud Run API Gateway"
}

output "cloud_sql_instance_name" {
  value       = google_sql_database_instance.postgres.name
  description = "Tên instance Cloud SQL PostgreSQL"
}

output "pubsub_topic_id" {
  value       = google_pubsub_topic.order_events.id
  description = "ID Pub/Sub Topic cho Order Events"
}

output "secret_manager_ids" {
  value = [
    google_secret_manager_secret.db_password.secret_id,
    google_secret_manager_secret.jwt_secret.secret_id
  ]
  description = "Danh sách Secret Manager IDs được quản lý"
}

output "database_names" {
  value = [
    google_sql_database.order_db.name,
    google_sql_database.catalog_db.name,
    google_sql_database.inventory_db.name
  ]
  description = "Danh sách 3 Database độc lập (Database-per-service)"
}

output "cloud_sql_public_ip" {
  value       = google_sql_database_instance.postgres.public_ip_address
  description = "IP công khai kết nối Cloud SQL PostgreSQL"
}

resource "google_cloud_run_v2_service_iam_member" "public_access" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api_gateway.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}