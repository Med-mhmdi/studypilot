import json
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]


def test_production_otlp_receiver_is_authenticated_and_separate():
    config = yaml.safe_load((ROOT / "observability/otel-collector.yml").read_text())

    production_receiver = config["receivers"]["otlp/production"]["protocols"]["grpc"]
    assert production_receiver["endpoint"] == "0.0.0.0:4319"
    assert production_receiver["auth"]["authenticator"] == "bearertokenauth/production"
    assert config["extensions"]["bearertokenauth/production"]["token"] == "$" + "{env:OTEL_INGEST_TOKEN}"
    assert set(config["service"]["pipelines"]["traces"]["receivers"]) == {"otlp", "otlp/production"}
    assert set(config["service"]["pipelines"]["metrics"]["receivers"]) == {"otlp", "otlp/production"}


def test_compose_and_dashboard_separate_demo_and_production():
    compose = yaml.safe_load((ROOT / "compose.observability.yml").read_text())
    collector_ports = compose["services"]["otel-collector"]["ports"]
    loki_ports = compose["services"]["loki-gateway"]["ports"]
    loki_query_ports = compose["services"]["loki"]["ports"]
    assert any("DOCKER_HOST_BRIDGE_IP" in port and ":14321:4319" in port for port in collector_ports)
    assert any("DOCKER_HOST_BRIDGE_IP" in port and ":13100:3100" in port for port in loki_ports)
    assert loki_query_ports == ["127.0.0.1:13101:3100"]
    gateway = (ROOT / "observability/loki-gateway.conf.template").read_text()
    assert "Bearer $OTEL_INGEST_TOKEN" in gateway
    assert "location / {\n        return 404;" in gateway
    assert compose["services"]["app"]["environment"]["OTEL_SERVICE_NAME"] == "studypilot-demo"

    dashboard = json.loads((ROOT / "observability/grafana/dashboards/studypilot-overview.json").read_text())
    assert "templating" not in dashboard
    assert len(dashboard["panels"]) == 8
    assert [panel["type"] for panel in dashboard["panels"][:4]] == ["stat"] * 4
    prometheus_panels = [panel for panel in dashboard["panels"] if panel["datasource"]["uid"] == "prometheus"]
    assert all(
        'service_name="studypilot-production"' in target["expr"]
        for panel in prometheus_panels
        for target in panel["targets"]
    )
    log_panel = next(panel for panel in dashboard["panels"] if panel["type"] == "logs")
    assert '{service="studypilot-production",source="dokku"}' in log_panel["targets"][0]["expr"]
    assert "line_format" in log_panel["targets"][0]["expr"]


def test_jaeger_memory_store_has_a_trace_limit():
    config = yaml.safe_load((ROOT / "observability/jaeger.yml").read_text())
    assert config["extensions"]["jaeger_storage"]["backends"]["memstore"]["memory"]["max_traces"] == 5000


def test_webserver_access_logs_cannot_leak_raw_query_strings():
    dockerfile = (ROOT / "Dockerfile").read_text()
    assert "--no-access-log" in dockerfile
