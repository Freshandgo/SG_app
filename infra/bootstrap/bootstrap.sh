#!/usr/bin/env bash
# Crée les ressources "long-lived" dont Terraform a besoin AVANT son premier init :
# le stockage du state et le Key Vault des secrets. À lancer une seule fois.
set -euo pipefail

LOCATION="canadacentral"
RG="rg-paiement-shared"
SUFFIX="sg42"
SA="sttfstate${SUFFIX}"          # 3-24 caractères, minuscules + chiffres, unique au monde
KV="kv-paiement-${SUFFIX}"       # 3-24 caractères, unique au monde

ME=$(az ad signed-in-user show --query id -o tsv | tr -d '\r')

# --- State storage ---
az storage account create -n "$SA" -g "$RG" -l "$LOCATION" \
   --sku Standard_LRS --min-tls-version TLS1_2 \
   --allow-blob-public-access false
az storage account blob-service-properties update -n "$SA" -g "$RG" \
  --enable-versioning true
SA_ID=$(az storage account show -n "$SA" -g "$RG" --query id -o tsv | tr -d '\r')
az role assignment create --assignee "$ME" \
  --role "Storage Blob Data Contributor" --scope "$SA_ID"


# --- Key Vault (mode RBAC) ---
#az keyvault create -n "$KV" -g "$RG" -l "$LOCATION" --enable-rbac-authorization true
az keyvault create -n "$KV" -g "$RG" -l "$LOCATION" --enable-rbac-authorization true
KV_ID=$(az keyvault show -n "$KV" --query id -o tsv | tr -d '\r')
az role assignment create --assignee "$ME" \
  --role "Key Vault Secrets Officer" --scope "$KV_ID"

echo "Attente de la propagation des rôles (60 s)..."
sleep 60

az storage container create -n tfstate --account-name "$SA" --auth-mode login

# --- Secrets Stripe (saisis au clavier, jamais écrits sur disque) ---
read -rsp "STRIPE_SECRET_KEY (sk_test_...): " STRIPE_SECRET_KEY; echo
read -rsp "STRIPE_WEBHOOK_SECRET (whsec_...): " STRIPE_WEBHOOK_SECRET; echo
az keyvault secret set --vault-name "$KV" -n stripe-secret-key     --value "$STRIPE_SECRET_KEY"     -o none
az keyvault secret set --vault-name "$KV" -n stripe-webhook-secret --value "$STRIPE_WEBHOOK_SECRET" -o none

echo "OK. Storage account: $SA  |  Key Vault: $KV"
