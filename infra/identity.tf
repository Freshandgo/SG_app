# Infos du compte connecté (tenant, subscription) : lecture seule.
data "azurerm_client_config" "current" {}

# Identité utilisée par GitHub Actions pour déployer (OIDC, sans mot de passe).
resource "azurerm_user_assigned_identity" "github" {
  name                = "id-github-actions"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}

# Seul le workflow de la branche main de ce repo peut utiliser cette identité.
resource "azurerm_federated_identity_credential" "github_main" {
  name                = "github-main"
  resource_group_name = azurerm_resource_group.rg.name
  parent_id           = azurerm_user_assigned_identity.github.id
  audience            = ["api://AzureADTokenExchange"]
  issuer              = "https://token.actions.githubusercontent.com"
  subject             = "repo:${var.github_repository}:ref:refs/heads/main"
}

# Moindre privilège : Contributor limité au RG de l'app.
resource "azurerm_role_assignment" "github_rg" {
  scope                = azurerm_resource_group.rg.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.github.principal_id
}
