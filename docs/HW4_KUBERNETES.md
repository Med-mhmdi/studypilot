# HW4 Kubernetes · StudyPilot Assignment Tracker

Due November 27, 2026. The tracker under `hw4/` is a separate FastAPI application for the Kubernetes assignment. The existing StudyPilot site runs on Dokku with its own SQLite database. The tracker starts with an empty PostgreSQL database and uses synthetic demo data.

```text
HTTP client → ClusterIP Service → 3 FastAPI pods → CNPG -rw Service → PostgreSQL primary
                                                                         │
                                                                  streaming WAL
                                                                         ↓
                                                                  PostgreSQL standby
```

The application Helm release manages its Deployment, Service and disruption budget. The CNPG Cluster lives separately so a Helm rollback or uninstall leaves the database in place. CNPG provisions one local-path PVC per instance and creates the application's credentials. The app receives the application owner's connection URI and the public CA certificate for TLS verification. CloudNativePG moves the read-write Service when it promotes a standby. The app opens fresh connections and reports itself unready during a database outage.

## 1. Check Dell's capacity

Run these commands in a Bash shell on Dell. You need Docker, k3d 5.8.3, kubectl, Helm 3 or 4, Python 3, git and curl. Use your existing Docker access and [the k3d installation instructions](https://k3d.io/stable/#installation) if needed.

```bash
hostname
free -h
df -h "$HOME" "$(docker info --format '{{.DockerRootDir}}')"
docker info --format 'cgroup version {{.CgroupVersion}}'
docker stats --no-stream
ss -ltn '( sport = :16550 or sport = :18080 )'
k3d cluster list
```

Allow at least 4 GiB of available RAM and 10 GiB of free disk for the demo, plus headroom for the existing workload. The three app pods and two database instances request 350 millicores and 576 MiB of RAM together. Their limits total 1.75 cores and 1,152 MiB before the operator, Kubernetes and a rolling upgrade. The k3s server container below has a 3 GiB memory cap. The two 2 GiB claims use local storage, which does not enforce per-volume quotas. If Dell is short on capacity or the loopback ports are already used, use another host or adjust the port values. Check usage during rehearsal.

## 2. Start the dedicated k3s cluster

Run from a fresh checkout of the HW4 branch.

```bash
git clone --branch feature/hw4-kubernetes --single-branch https://github.com/Med-mhmdi/studypilot.git studypilot-hw4-demo
cd studypilot-hw4-demo
umask 077
export KUBECONFIG="$PWD/.tmp/dell-kubeconfig"
mkdir -p .tmp "$HOME/.local/share/studypilot-hw4/storage"

k3d cluster create studypilot-hw4 \
  --image rancher/k3s:v1.35.2-k3s1 --servers 1 --servers-memory 3g \
  --api-port 127.0.0.1:16550 --no-lb \
  --k3s-arg '--disable=traefik,servicelb,metrics-server@server:0' \
  --volume "$HOME/.local/share/studypilot-hw4/storage:/var/lib/rancher/k3s/storage@server:0" \
  --kubeconfig-update-default=false --kubeconfig-switch-context=false --wait --timeout 180s

k3d kubeconfig get studypilot-hw4 > "$KUBECONFIG"
kubectl get nodes -o wide
kubectl get storageclass local-path
```

Kubernetes 1.35 defaults to cgroup v2. If Docker reports cgroup v1, add the following flag to the cluster create command: `--k3s-arg '--kubelet-arg=fail-cgroupv1=false@server:0'`. This changes only the HW4 kubelet. See the [Kubernetes cgroup guidance](https://kubernetes.io/blog/2026/10/06/kubernetes-cgroups-v2-shift/).

The API and the application port forward listen on loopback. k3d runs k3s in its own Docker network with no mapping for ports 80 or 443. The bind mount keeps PostgreSQL files across restarts of the cluster. Deleting the cluster discards Kubernetes metadata, including credentials and volume bindings. The files alone are not a backup. Both PostgreSQL pods share one node, so the demo covers primary pod failure. A Dell or disk failure can take down both.

## 3. Install CloudNativePG and deploy the app

Use the dedicated kubeconfig in every terminal. The pinned operator chart uses CloudNativePG 1.30.1. See [CloudNativePG Helm charts](https://cloudnative-pg.io/charts/).

```bash
set -euo pipefail
test "$(kubectl config current-context)" = k3d-studypilot-hw4
ns=studypilot-hw4

helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo update cnpg
helm upgrade --install cnpg cnpg/cloudnative-pg --version 0.29.1 \
  --namespace cnpg-system --create-namespace --wait --timeout 5m
kubectl wait --for=condition=Established crd/clusters.postgresql.cnpg.io --timeout=120s
kubectl -n cnpg-system rollout status deployment/cnpg-cloudnative-pg --timeout=180s

kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$ns" apply --dry-run=server -f deploy/hw4/database.yaml
kubectl -n "$ns" apply -f deploy/hw4/database.yaml
kubectl -n "$ns" wait --for=condition=Ready cluster/studypilot-hw4-db --timeout=10m

tag="$(git rev-parse --short=12 HEAD)"
docker build -t "studypilot-hw4:$tag" ./hw4
k3d image import "studypilot-hw4:$tag" -c studypilot-hw4
helm lint deploy/hw4/chart
helm upgrade --install studypilot-hw4 deploy/hw4/chart --namespace "$ns" \
  --set-string "image.tag=$tag" --wait --timeout 5m
kubectl -n "$ns" rollout status deployment/studypilot-hw4-app --timeout=180s
```

For an app upgrade, check out the new revision and repeat from `tag=` through rollout. The old image stays in k3s for `helm -n studypilot-hw4 rollback studypilot-hw4 <revision> --wait`. Use `helm -n studypilot-hw4 history studypilot-hw4` to find the revision. The bootstrap SQL runs only at database creation. Future schema changes require a separate migration. `helm -n studypilot-hw4 uninstall studypilot-hw4` removes the app release and preserves the CNPG Cluster and PVCs.

## 4. Rehearse and collect demo evidence

From Dell, capture these outputs. They contain pod and synthetic assignment identifiers, with no database credentials.

```bash
kubectl get nodes -o wide
helm -n studypilot-hw4 list
kubectl -n studypilot-hw4 get deploy,pods,svc,pvc,cluster -o wide
kubectl -n studypilot-hw4 get endpointslice \
  -l kubernetes.io/service-name=studypilot-hw4-app -o wide
python3 deploy/hw4/verify.py
python3 deploy/hw4/verify.py --failover
kubectl -n studypilot-hw4 get pods,cluster -o wide
```

The verifier sends separate HTTP connections through the Service and confirms every ready pod replies. It creates and completes an assignment and checks that PostgreSQL replayed the update on the standby. With `--failover` it deletes the current primary pod in the homework namespace. It waits for promotion and rejoin, checks both roles, and reads and updates the same assignment through the Service. Expect a brief period of unavailability during failover. Replication is asynchronous. The test waits for the marker to reach the standby before triggering failover.

For browser access, keep this running in a second Dell terminal from the checkout:

```bash
export KUBECONFIG="$PWD/.tmp/dell-kubeconfig"
kubectl -n studypilot-hw4 port-forward --address 127.0.0.1 svc/studypilot-hw4-app 18080:80
```

On Dell, open `http://127.0.0.1:18080/docs`. From another machine with verified SSH access, forward the port with `ssh -o StrictHostKeyChecking=yes -N -L 18080:127.0.0.1:18080 dexter` and open the same URL. Use **Try it out** on `POST /assignments` with `{"title":"Prepare Kubernetes demo"}`, then show `GET /assignments`. The port forward goes to one selected pod. Use the verifier to show Service load balancing.

### Speaker notes and screenshots

1. Say “This is the StudyPilot Assignment Tracker I deployed for HW4 on k3s. The existing StudyPilot site is a separate Dokku deployment.” Capture the node, Helm release and three ready app pods.
2. Open the tracker and add an assignment. Capture the API page and returned record.
3. Run the verifier with `--failover`. Capture the three responding pod names, streaming replica confirmation, and the primary change with the same assignment readable and writable. Show the final two database pods and their roles.
4. Explain that both database instances run on Dell and that the experiment tests primary pod failure. Show the two bound PVCs.

If something stalls, check `kubectl -n studypilot-hw4 get events --sort-by=.lastTimestamp`, `kubectl -n studypilot-hw4 describe cluster studypilot-hw4-db`, and `kubectl -n cnpg-system logs deployment/cnpg-cloudnative-pg --tail=80`. For `ErrImageNeverPull`, confirm the exact tag was imported into the correct k3d cluster.
