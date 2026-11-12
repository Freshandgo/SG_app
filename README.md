# SG_app — Terminal de paiement Freshandgo

Application de caisse (UI React + backend Stripe) conteneurisée et déployée sur **Azure Container Apps** par Terraform et GitHub Actions.

| Dossier                          | Contenu                                                                  |
| -------------------------------- | ------------------------------------------------------------------------ |
| `apps/frontend/`               | UI de caisse — TanStack Start compilé par Nitro (preset `bun`)       |
| `apps/stripe-paiement/`        | Service Bun : réception des webhooks Stripe, API `/payments`          |
| `infra/`                       | Terraform (Azure) + `bootstrap/` (ressources créées avant Terraform) |
| `.github/workflows/deploy.yml` | Build des images et déploiement                                         |
| `load/`                        | Test de charge k6 et scripts d'observation du scaling                    |

---

## 1. Lancer le projet en local

Prérequis : Docker, une clé Stripe **test** (`sk_test_...`).

Créer un fichier `.env` à la racine (gitignoré, ne jamais le commiter) :

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...   # une valeur factice suffit en local
```

Puis :

```bash
docker compose up --build
```

| Service  | URL locale            |
| -------- | --------------------- |
| Frontend | http://localhost:3000 |
| Payments | http://localhost:8081 |

Vérification : `curl localhost:3000/health` et `curl localhost:8081/health` → `ok`.

Un paiement de bout en bout fonctionne en local : l'UI utilise un **lecteur Stripe Terminal simulé** (`USE_SIMULATED_READER` dans `apps/frontend/src/routes/index.tsx`) et le paiement apparaît dans le dashboard Stripe en mode test.

---

## 2. Construction et déploiement

### Infrastructure (Terraform, manuel)

L'infra est découpée en deux couches selon leur durée de vie :

| Couche                                         | Ressources                                                                                        | Créée par                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Long-lived** — `rg-paiement-shared` | Storage Account (state Terraform), Key Vault (secrets Stripe)                                     | `infra/bootstrap/bootstrap.sh`, une seule fois |
| **Application** — `rg-paiement`       | Log Analytics, Container Apps Environment, `ca-frontend`, `ca-payments`, identités managées | Terraform                                        |

Première installation :

```bash
az login
az group create -n rg-paiement-shared -l canadacentral
./infra/bootstrap/bootstrap.sh          # state storage + Key Vault + saisie des secrets Stripe

cd infra
cp terraform.tfvars.example terraform.tfvars   # docker_owner, github_repository, key_vault_name
export ARM_SUBSCRIPTION_ID=$(az account show --query id -o tsv | tr -d '\r')
terraform init
terraform apply
terraform output frontend_url
```

`tr -d '\r'` est nécessaire si `az` est la version Windows appelée depuis WSL.

### Application (GitHub Actions, automatique)

Chaque push sur `main` qui touche `apps/**` déclenche `deploy.yml` :

1. **build** — construit les deux images (matrice) et les pousse sur Docker Hub avec deux tags : `:<sha du commit>` et `:latest`.
2. **deploy** — se connecte à Azure par **OIDC** et lance `az containerapp update --image ...:<sha>`, ce qui crée une nouvelle révision. Azure n'y bascule le trafic qu'une fois la readiness probe `/health` au vert.

Secrets GitHub requis : `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`. Les trois IDs Azure se lisent avec `terraform output`.

**Rollback** : réactiver une révision précédente.

```bash
az containerapp revision list -n ca-frontend -g rg-paiement -o table
az containerapp revision activate -n ca-frontend -g rg-paiement --revision <nom>
```

---

## 3. Décisions techniques clés

| Décision                                                                                                        | Pourquoi                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Azure Container Apps** plutôt que VM, App Service ou AKS                                                | Autoscaling HTTP intégré (KEDA), HTTPS et URL publique fournis, révisions pour le rollback. AKS serait trop lourd à opérer pour ce périmètre.     |
| **Scale-to-zero** (`min_replicas = 0` par défaut)                                                       | Coût nul au repos. Contrepartie : cold start de quelques secondes sur la première requête. `-var min_replicas=1` pour une démo.                    |
| **Scaling sur la concurrence HTTP** (50 requêtes simultanées par réplica, max 10 frontend / 5 payments) | La charge de l'app est faite de requêtes HTTP courtes ; la concurrence suit directement la demande.                                                     |
| **Probes sur `/health`** court-circuité avant le SSR                                                    | La probe vérifie que le processus répond, sans rendu React ni appel à Stripe. Une panne Stripe ne provoque pas de redémarrages en cascade.           |
| **Secrets dans Key Vault**, lus par les apps via une identité managée                                    | Aucune clé Stripe dans le code, les tfvars ou le state Terraform : Terraform ne connaît que l'URL du secret.                                           |
| **State Terraform distant** (Storage Account, auth Entra ID, versioning)                                   | Verrouillage contre les `apply` concurrents, historique des versions, rien de sensible en local.                                                       |
| **Bootstrap hors Terraform** pour le state et le Key Vault                                                 | Le state ne peut pas stocker sa propre création ; le soft-delete du Key Vault bloquerait sa recréation après un `destroy`.                          |
| **OIDC GitHub → Azure**                                                                                   | Aucun mot de passe Azure dans GitHub ; jetons temporaires, limités au repo et à la branche `main`, rôle `Contributor` limité à `rg-paiement`. |
| **Terraform gère l'infra, la CI gère l'image** (`lifecycle.ignore_changes` sur l'image)                | Un `terraform apply` n'écrase pas la version déployée par la CI.                                                                                    |
| **Pas de base de données**                                                                                | L'état des paiements vit chez Stripe ; rien à persister côté application.                                                                            |
| **Validation serveur du montant** (`createPaymentIntent`)                                                | Le slider de l'UI ne protège pas l'endpoint : la server function est appelable directement en HTTP.                                                     |

---

## 4. Comportement sous charge

Les scripts du dossier `load/` s'utilisent dans deux terminaux : l'un génère la charge, l'autre observe le scaling.

### `load/k6-frontend-test.js` — le scénario de charge

Script k6 qui simule des utilisateurs virtuels (VUs) envoyant des requêtes `GET /health` au frontend.

- **`stages`** : le nombre de VUs monte progressivement, reste élevé, puis redescend, ce qui permet de voir les réplicas apparaître puis disparaître.
- **Pas de pause entre les requêtes** : chaque VU renvoie une requête dès la précédente terminée. Le nombre de requêtes simultanées suit donc le nombre de VUs, et c'est cette simultanéité qui déclenche la règle de scaling.
- **`check`** : compte les réponses qui ne sont pas des `200`.
- **`thresholds`** : critères de réussite (taux d'erreur et latence p95). k6 les affiche comme réussis ou échoués à la fin et renvoie un code d'erreur s'ils ne sont pas respectés.
- L'URL cible est passée en paramètre (`-e BASE_URL=...`) : le même script sert en local et sur Azure.

### `load/run-k6.sh` — le lanceur

Enveloppe autour de k6 qui sécurise le lancement :

1. Se place à la racine du repo, quel que soit le dossier d'appel.
2. Vérifie que `k6` est installé.
3. Récupère l'URL du frontend avec `terraform output`, ou utilise celle passée en argument.
4. Vérifie que l'URL est en `https://` et que `/health` répond avant de lancer le test, pour ne pas charger une app absente.
5. Lance k6 et enregistre la sortie dans `load/run-scaling-test.txt` (gitignoré).

```bash
./load/run-k6.sh                 # URL lue depuis Terraform
./load/run-k6.sh https://...     # URL forcée
```

### `load/replicas.sh` — l'observation du scaling

Boucle qui, toutes les 10 secondes, demande à Azure le nombre de réplicas actifs de `ca-frontend` (`az containerapp replica list`) et l'affiche avec l'heure. On le lance dans un second terminal pendant le test pour suivre la montée puis la redescente des réplicas. `Ctrl+C` pour l'arrêter.

```bash
./load/replicas.sh
```

Le portail Azure donne la même information sous forme de courbe : `ca-frontend` → Monitoring → Metrics → *Replica Count*.

---

## 5. Limitations et améliorations

### Limitations actuelles

- **Le test de charge cible `/health`**, pas le rendu SSR de `/` : il prouve le scaling de la plateforme mais sous-estime le coût réel d'une page.
- **Le smoke test vérifie que l'app répond**, pas que la nouvelle révision est celle qui sert le trafic : si la nouvelle image ne démarre pas, l'ancienne révision continue de répondre et le smoke test peut rester vert.
- **Pas de CI sur les pull requests ni de tests automatisés.** Choix assumé pour un projet mené seul, déployé directement depuis `main`. En équipe, on passerait par des pull requests avec revue obligatoire et une CI requise (lint, tests, build) avant le merge.
- **L'identité CI vit dans `rg-paiement`** : un `terraform destroy` la supprime, et il faut mettre à jour `AZURE_CLIENT_ID` après recréation (les URLs changent aussi). En pratique, l'infra reste en place avec `min_replicas = 0` (coût quasi nul au repos) et n'est détruite qu'en fin de projet.
- **Cold start** : avec le scale-to-zero, la première requête après une période d'inactivité attend le démarrage d'un réplica.
- **L'infra n'est pas déployée par la CI** : `terraform apply` reste manuel.
- **`/payments` n'a pas d'authentification** et son ingress est public (nécessaire pour les webhooks Stripe, pas pour `/payments`).
- **Un seul environnement**, pas de staging.

### Améliorations possibles

- Smoke test complet : vérifier aussi que la dernière révision est prête et porte l'image du commit.
- Workflow `ci.yml` sur les PR (lint, tests unitaires, build, `terraform plan`), puis `terraform apply` en CI avec une identité dédiée.
- Tests d'intégration avec Stripe en mode test et tests end-to-end (Playwright).
- Déplacer l'identité OIDC dans la couche long-lived pour stabiliser `AZURE_CLIENT_ID`.
- Test de charge sur `/` (SSR) et comparaison avec `max_replicas = 1` pour chiffrer le gain du scaling.
- Domaine personnalisé + certificat managé, puis Azure Front Door / WAF devant les apps.
- Authentification sur `/payments`, clés d'idempotence Stripe.
- Environnement de staging et déploiement progressif (traffic split entre révisions).
- Alertes Azure Monitor (taux d'erreur, latence, réplicas au maximum).
- Migration vers AKS + Helm + Argo CD si le nombre de services augmente.
