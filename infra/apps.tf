locals {
  payments_image = "docker.io/${var.docker_owner}/sg-app-paiement:${var.image_tag}"
  frontend_image = "docker.io/${var.docker_owner}/sg-app-frontend:${var.image_tag}"
}

# --- Backend : apps/stripe-paiement ---
resource "azurerm_container_app" "payments" {
  name                         = "ca-payments"
  resource_group_name          = azurerm_resource_group.rg.name
  container_app_environment_id = azurerm_container_app_environment.env.id
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.apps.id]
  }

  secret {
    name                = "stripe-secret-key"
    key_vault_secret_id = local.kv_secret_stripe_key
    identity            = azurerm_user_assigned_identity.apps.id
  }
  secret {
    name                = "stripe-webhook-secret"
    key_vault_secret_id = local.kv_secret_stripe_webhook
    identity            = azurerm_user_assigned_identity.apps.id
  }

  # Externe : Stripe doit pouvoir appeler /webhooks/stripe.
  ingress {
    external_enabled = true
    target_port      = 8080
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.min_replicas
    max_replicas = 5

    container {
      name   = "payments"
      image  = local.payments_image
      cpu    = 0.5
      memory = "1Gi"

      env {
        name        = "STRIPE_SECRET_KEY"
        secret_name = "stripe-secret-key"
      }
      env {
        name        = "STRIPE_WEBHOOK_SECRET"
        secret_name = "stripe-webhook-secret"
      }

      liveness_probe {
        transport = "HTTP"
        port      = 8080
        path      = "/health"
      }
      readiness_probe {
        transport = "HTTP"
        port      = 8080
        path      = "/health"
      }
    }

    http_scale_rule {
      name                = "http-scaling"
      concurrent_requests = "50"
    }
  }

  # Terraform gère l'infra, la CI gère la version de l'image.
  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }

  # Le rôle doit exister avant que l'app lise le Vault.
  depends_on = [azurerm_role_assignment.apps_kv]
}

# --- Frontend : apps/frontend ---
resource "azurerm_container_app" "frontend" {
  name                         = "ca-frontend"
  resource_group_name          = azurerm_resource_group.rg.name
  container_app_environment_id = azurerm_container_app_environment.env.id
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.apps.id]
  }

  # Le frontend n'utilise que STRIPE_SECRET_KEY (src/lib/stripe-server.ts).
  secret {
    name                = "stripe-secret-key"
    key_vault_secret_id = local.kv_secret_stripe_key
    identity            = azurerm_user_assigned_identity.apps.id
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.min_replicas
    max_replicas = 10

    container {
      name   = "frontend"
      image  = local.frontend_image
      cpu    = 0.5
      memory = "1Gi"

      env {
        name        = "STRIPE_SECRET_KEY"
        secret_name = "stripe-secret-key"
      }

      liveness_probe {
        transport = "HTTP"
        port      = 8080
        path      = "/health"
      }
      readiness_probe {
        transport = "HTTP"
        port      = 8080
        path      = "/health"
      }
    }

    http_scale_rule {
      name                = "http-scaling"
      concurrent_requests = "50"
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }

  depends_on = [azurerm_role_assignment.apps_kv]
}
