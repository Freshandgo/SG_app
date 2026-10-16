output "frontend_url" {
  value = "https://${azurerm_container_app.frontend.ingress[0].fqdn}"
}

output "payments_url" {
  value = "https://${azurerm_container_app.payments.ingress[0].fqdn}"
}

output "resource_group" {
  value = azurerm_resource_group.rg.name
}

# Valeurs à copier dans les secrets GitHub pour azure/login (OIDC).
output "azure_client_id" {
  value = azurerm_user_assigned_identity.github.client_id
}

output "azure_tenant_id" {
  value = data.azurerm_client_config.current.tenant_id
}

output "azure_subscription_id" {
  value = data.azurerm_client_config.current.subscription_id
}
