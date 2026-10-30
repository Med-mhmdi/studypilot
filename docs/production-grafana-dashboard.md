# Updating the StudyPilot production Grafana dashboard

The dashboard is provisioned from `observability/grafana/dashboards/studypilot-overview.json`. Its Prometheus queries are pinned to `service_name="studypilot-production"`, and its Loki query is pinned to `{service="studypilot-production",source="dokku"}`. It does not include the Compose demo service.

After this change is reviewed, merged, and a production update is explicitly approved, copy the dashboard and provider files on the Dell host. Do not pull the repository into the existing checkout: the Dell Compose file has a local production-only edit that must be preserved. The provider polls every 15 seconds, avoiding Docker bind-mount file-watch limitations.

```bash
cd ~/studypilot-hw3
git fetch origin main
git show FETCH_HEAD:observability/grafana/dashboards/studypilot-overview.json > /tmp/studypilot-overview.json.new
git show FETCH_HEAD:observability/grafana/provisioning/dashboards/provider.yml > /tmp/studypilot-provider.yml.new
python3 -m json.tool /tmp/studypilot-overview.json.new >/dev/null

dashboard=observability/grafana/dashboards/studypilot-overview.json
provider=observability/grafana/provisioning/dashboards/provider.yml
stamp=$(date +%Y%m%d-%H%M%S)
dashboard_backup="$dashboard.bak.$stamp"
provider_backup="$provider.bak.$stamp"
cp -a "$dashboard" "$dashboard_backup"
cp -a "$provider" "$provider_backup"
install -m 0644 /tmp/studypilot-overview.json.new "$dashboard"
install -m 0644 /tmp/studypilot-provider.yml.new "$provider"
docker compose --env-file .env.observability -f compose.observability.yml restart grafana
```

The targeted restart reloads the provider configuration and dashboard; it does not restart the StudyPilot app. Grafana may be briefly unavailable while its own container restarts. This procedure does not change the Dokku deployment, database, or volumes. If the dashboard does not reload correctly, restore both backups and restart Grafana again:

```bash
cp -a "$dashboard_backup" "$dashboard"
cp -a "$provider_backup" "$provider"
docker compose --env-file .env.observability -f compose.observability.yml restart grafana
```

This procedure changes Grafana's provisioned dashboard only after the PR is merged and the production update is approved. It does not alter the locally edited Compose file.
