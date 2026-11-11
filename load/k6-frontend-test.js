import http from "k6/http";
import { check } from "k6";

// URL passée en variable d'env : k6 run -e BASE_URL=https://... load/k6-frontend.js
const BASE_URL = __ENV.BASE_URL;

export const options = {
  stages: [
    { duration: "30s", target: 20 },   // montée
    { duration: "2m",  target: 100 },  // > 50 req concurrentes → déclenche le scale-out
    { duration: "30s", target: 0 },    // descente
  ],
  thresholds: {
    http_req_failed:   ["rate<0.01"],  // moins de 1 % d'erreurs
    http_req_duration: ["p(95)<500"],  // p95 sous 500 ms
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/health`);
  check(res, {
    "status 200": (r) => r.status === 200,
  });
  // Pas de sleep : chaque VU enchaîne les requêtes, donc 100 VUs ≈ 100 requêtes
  // simultanées. Avec sleep(1), on n'en avait que ~5 et aucun scale-out.
}

