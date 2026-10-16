terraform {
  backend "azurerm" {
    resource_group_name  = "rg-paiement-shared"
    storage_account_name = "sttfstatesg42"     # le vôtre
    container_name       = "tfstate"
    key                  = "sg_app.tfstate"    # nom du fichier dans le conteneur
    use_azuread_auth     = true
  }
}
