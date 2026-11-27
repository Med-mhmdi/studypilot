# Original StudyPilot on k3s (disposable HW4 environment)

This deployment builds the app in this repository and starts the original FastAPI UI/API with three replicas. It creates an empty PostgreSQL cluster with CloudNativePG (one primary and one standby). It does not import `data/studypilot.db` or affect Dokku. The test deployment shares one session secret and disables profile-photo uploads because local disk is not shared between pods.

## Dell deployment

Run from the root of a checkout of this branch on Dell. The script expects Docker, k3d, kubectl, Helm, and OpenSSL. It creates an isolated cluster named `study-hw4` and exposes the app on port 30800. The host must have at least 4 GB RAM available.

```bash
set -euo pipefail
cd ~/studypilot
k3d cluster create study-hw4 --servers 1 --agents 2 --port '30800:30800@loadbalancer' --wait
kubectl create namespace hw4 --dry-run=client -o yaml | kubectl apply -f -
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo update
helm upgrade --install cnpg cnpg/cloudnative-pg --namespace cnpg-system --create-namespace --wait --timeout 5m
docker build -t studypilot:hw4 .
k3d image import studypilot:hw4 --cluster study-hw4
kubectl apply -f deploy/hw4/database.yaml
kubectl -n hw4 wait --for=condition=Ready cluster/studypilot-db --timeout=10m
kubectl -n hw4 create secret generic studypilot-session \
  --from-literal=SESSION_SECRET="$(openssl rand -base64 48)" \
  --dry-run=client -o yaml | kubectl apply -f -
helm upgrade --install studypilot deploy/hw4/chart --namespace hw4 --wait --timeout 5m
kubectl -n hw4 rollout status deployment/studypilot --timeout=5m
kubectl -n hw4 get pods -o wide
kubectl -n hw4 get cluster studypilot-db
curl -fsS http://127.0.0.1:30800/health
```

Open `http://<dell-ip>:30800/` and register a throwaway account. Sign-in and create a project/task to exercise PostgreSQL-backed workflows. Confirm balancing across pods with `for i in $(seq 1 12); do curl -fsS http://127.0.0.1:30800/health >/dev/null; done` and inspect `kubectl -n hw4 get endpoints studypilot`.

The database stays disposable. Remove only this homework cluster with `k3d cluster delete study-hw4`; Dokku runs separately.
