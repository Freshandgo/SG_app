variable "location" {
  type    = string
  default = "canadacentral"
}

variable "resource_group_name" {
  type    = string
  default = "rg-paiement"
}

variable "shared_resource_group_name" {
  description = "RG long-lived qui contient le Key Vault et le state"
  type        = string
  default     = "rg-paiement-shared"
}

variable "key_vault_name" {
  description = "Key Vault créé par bootstrap.sh"
  type        = string
}


variable "docker_owner" {
  description = "Utilisateur Docker, en minuscules"
  type        = string
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "github_repository" {
  description = "Repo GitHub autorisé à déployer via OIDC (owner/nom, casse exacte)"
  type        = string
}
