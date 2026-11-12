"""Verify the HW4 deployment. --failover deletes only its current primary pod."""

import argparse
import json
import subprocess
import time
from uuid import UUID, uuid4

NS = "studypilot-hw4"
DB = "studypilot-hw4-db"
APP = "studypilot-hw4-app"

# Running inside a pod reaches the real ClusterIP, unlike kubectl port-forward.
HTTP = """
import json, sys
from urllib.request import Request, urlopen

path, method, payload, count = sys.argv[1:]
for _ in range(int(count)):
    request = Request(
        "http://studypilot-hw4-app" + path,
        data=payload.encode() if payload else None,
        headers={"Content-Type": "application/json", "Connection": "close"},
        method=method,
    )
    with urlopen(request, timeout=6) as response:
        print(json.dumps(json.load(response)))
"""


def kube(*args):
    return subprocess.check_output(
        ["kubectl", "--request-timeout=45s", "-n", NS, *args], text=True, timeout=50
    ).strip()


def cluster_status():
    return json.loads(kube("get", "cluster", DB, "-o", "json"))["status"]


def http(path, method="GET", body=None, count=1):
    lines = kube(
        "exec", f"deployment/{APP}", "--", "python", "-c", HTTP,
        path, method, json.dumps(body) if body is not None else "", str(count),
    )
    return [json.loads(line) for line in lines.splitlines()]


def sql(pod, query):
    return kube(
        "exec", pod, "-c", "postgres", "--",
        "psql", "-XAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "studypilot", "-c", query,
    )


def wait_for(label, condition, seconds=180):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = condition()
        if result:
            return result
        time.sleep(2)
    raise SystemExit(f"Timed out waiting for {label}")


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def has_assignment(pod, assignment_id):
    return sql(pod, f"SELECT completed FROM public.assignments WHERE id = '{assignment_id}'") == "t"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--failover", action="store_true", help="delete the HW4 primary pod and verify promotion")
    args = parser.parse_args()

    deployment = json.loads(kube("get", "deployment", APP, "-o", "json"))
    replicas = deployment["spec"]["replicas"]
    require(replicas >= 2 and deployment["status"].get("readyReplicas") == replicas,
            "Expected multiple ready application pods")
    pods = json.loads(kube(
        "get", "pods", "-l", "app.kubernetes.io/instance=studypilot-hw4", "-o", "json"
    ))
    expected = {
        pod["metadata"]["name"] for pod in pods["items"]
        if not pod["metadata"].get("deletionTimestamp")
        and any(c["type"] == "Ready" and c["status"] == "True" for c in pod["status"].get("conditions", []))
    }
    seen = {row["pod"] for row in http("/instance", count=max(80, 12 * replicas))}
    require(seen == expected and len(seen) == replicas, f"Expected {expected}, Service reached {seen}")
    print(f"Service reached {replicas} ready application pods: {', '.join(sorted(seen))}", flush=True)

    status = cluster_status()
    primary = status["currentPrimary"]
    candidates = set(status["instanceNames"]) - {primary}
    require(status["readyInstances"] == 2 and len(candidates) == 1, "Expected two ready database pods")
    replica = candidates.pop()
    require(sql(primary, "SELECT pg_is_in_recovery()") == "f", "Expected a writable primary")
    require(sql(replica, "SELECT pg_is_in_recovery()") == "t", "Expected a standby in recovery")
    require(sql(primary, "SELECT count(*) FROM pg_stat_replication WHERE state = 'streaming'") == "1",
            "Expected one streaming standby")

    assignment = http("/assignments", "POST", {"title": f"HW4 replication demo {uuid4().hex[:8]}"})[0]
    assignment_id = UUID(assignment["id"])
    updated = http(f"/assignments/{assignment_id}", "PATCH", {"completed": True})[0]
    require(updated["completed"], "Assignment update failed")
    wait_for("the assignment on the standby", lambda: has_assignment(replica, assignment_id), seconds=30)
    print(f"{primary} is primary, {replica} is streaming and has assignment {assignment_id}", flush=True)

    if not args.failover:
        return

    kube("delete", "pod", primary, "--wait=false")
    print(f"Deleted HW4 primary pod {primary}; waiting for {replica} to promote", flush=True)
    wait_for("CNPG promotion", lambda: cluster_status().get("currentPrimary") == replica)
    wait_for("both CNPG instances to recover", lambda: cluster_status().get("readyInstances") == 2)
    wait_for("application readiness", lambda: json.loads(kube("get", "deployment", APP, "-o", "json"))
             ["status"].get("readyReplicas") == replicas)
    require(sql(replica, "SELECT pg_is_in_recovery()") == "f", "Promoted instance is not writable")
    require(sql(primary, "SELECT pg_is_in_recovery()") == "t", "Former primary did not rejoin as standby")
    require(any(row["id"] == str(assignment_id) for row in http("/assignments")[0]),
            "Application could not read the replicated assignment after failover")
    updated = http(f"/assignments/{assignment_id}", "PATCH", {"completed": False})[0]
    require(updated["completed"] is False, "Application could not write after failover")
    print(f"{replica} promoted, {primary} rejoined as standby, and application reads and writes recovered.")


if __name__ == "__main__":
    main()
