locals {
  # URL "sans version" → les apps prennent toujours la dernière version du secret.
  kv_secret_stripe_key     = "${data.azurerm_key_vault.kv.vault_uri}secrets/stripe-secret-key"
  kv_secret_stripe_webhook = "${data.azurerm_key_vault.kv.vault_uri}secrets/stripe-webhook-secret"
}

# Lecture du Vault existant (créé par bootstrap.sh) — "data" = lire, pas créer.
data "azurerm_key_vault" "kv" {
  name                = var.key_vault_name
  resource_group_name = var.shared_resource_group_name
}

# Identité que les Container Apps utiliseront pour lire le Vault.
resource "azurerm_user_assigned_identity" "apps" {
  name                = "id-paiement-apps"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}

# Droit minimal : lire les secrets de CE Vault, rien d'autre.
resource "azurerm_role_assignment" "apps_kv" {
  scope                = data.azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.apps.principal_id
}

