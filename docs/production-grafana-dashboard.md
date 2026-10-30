# Updating the StudyPilot production Grafana dashboard

The dashboard is provisioned from `observability/grafana/dashboards/studypilot-overview.json`. Its Prometheus queries are pinned to `service_name="studypilot-production"`, and its Loki query is pinned to `{service="studypilot-production",source="dokku"}`. It does not include the Compose demo service.

After this change is reviewed, merged, and a production update is explicitly approved, update only the dashboard JSON on the Dell host. Do not pull the repository into the existing checkout: the Dell Compose file has a local production-only edit that must be preserved.

```bash
cd ~/studypilot-hw3
git fetch origin main
git show FETCH_HEAD:observability/grafana/dashboards/studypilot-overview.json > /tmp/studypilot-overview.json.new
python3 -m json.tool /tmp/studypilot-overview.json.new >/dev/null

dashboard=observability/grafana/dashboards/studypilot-overview.json
backup="$dashboard.bak.$(date +%Y%m%d-%H%M%S)"
cp -a "$dashboard" "$backup"
install -m 0644 /tmp/studypilot-overview.json.new "$dashboard"
```

The Grafana file provider polls for dashboard changes every 10 seconds. Refresh the dashboard in the browser after that interval. No Compose command or Grafana restart is needed, and this procedure does not change the StudyPilot app, Dokku deployment, database, or volumes. If the dashboard does not reload, restore the backup file and refresh Grafana:

```bash
cp -a "$backup" "$dashboard"
```

This procedure changes the Dell dashboard only after the PR is merged and the production update is approved. It does not alter the locally edited Compose file.
