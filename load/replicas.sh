
#!/usr/bin/env bash

while true; do
  n=$(az containerapp replica list -n ca-frontend -g rg-paiement --query "length(@)" -o tsv | tr -d '\r')
  echo "$(date +%T)  réplicas=$n"
  sleep 10
done

