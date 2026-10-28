#!/usr/bin/env python3
"""Smoke-check the local HW3 stack end to end using only Python's standard library."""

from __future__ import annotations

import json
import os
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

APP = os.getenv("APP_URL", "http://127.0.0.1:18080").rstrip("/")
PROMETHEUS = "http://127.0.0.1:19090"
JAEGER = "http://127.0.0.1:16687"
LOKI = "http://127.0.0.1:13101"
SERVICE = os.getenv("OTEL_SERVICE_NAME", "studypilot-demo")
LOG_SELECTOR = os.getenv("LOKI_SELECTOR", '{service="studypilot-demo"}')
TIMEOUT_SECONDS = 120


def get_json(url: str) -> dict:
    with urlopen(Request(url, headers={"User-Agent": "StudyPilot-HW3-smoke-check"}), timeout=5) as response:
        return json.load(response)


def query_prometheus(query: str) -> list:
    payload = get_json(f"{PROMETHEUS}/api/v1/query?{urlencode({'query': query})}")
    if payload.get("status") != "success":
        raise RuntimeError(f"Prometheus query failed: {query}")
    return payload.get("data", {}).get("result", [])


def wait_for(label: str, check) -> None:
    deadline = time.monotonic() + TIMEOUT_SECONDS
    last_error = "not received yet"
    while time.monotonic() < deadline:
        try:
            if check():
                print(f"PASS: {label}")
                return
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
            last_error = str(exc)
        time.sleep(3)
    print(f"FAIL: {label} ({last_error})", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    with urlopen(f"{APP}/health", timeout=5) as response:
        if response.status != 200:
            raise SystemExit("FAIL: demo app health endpoint did not return HTTP 200")
    # Make enough traffic for a request counter, an error counter, spans, and logs.
    for _ in range(3):
        with urlopen(f"{APP}/health", timeout=5):
            pass
    try:
        urlopen(f"{APP}/not-a-real-page", timeout=5)
        raise SystemExit("FAIL: expected the unknown demo URL to return HTTP 404")
    except HTTPError as exc:
        if exc.code != 404:
            raise

    wait_for("Prometheus is scraping the OpenTelemetry Collector", lambda: any(float(row["value"][1]) > 0 for row in query_prometheus('up{job="otel-collector"}')))
    selector = f'{{service_name="{SERVICE}"}}'
    wait_for("HTTP request counter and duration histogram", lambda: bool(query_prometheus(f"studypilot_http_requests_total{selector}")) and bool(query_prometheus(f"studypilot_http_duration_seconds_count{selector}")))
    wait_for("HTTP error counter", lambda: bool(query_prometheus(f"studypilot_http_errors_total{selector}")))
    wait_for("in-flight request metric", lambda: bool(query_prometheus(f"studypilot_http_requests_in_flight{selector}")))

    def has_trace() -> bool:
        result = get_json(f"{JAEGER}/api/traces?{urlencode({'service': SERVICE, 'lookback': '1h', 'limit': 20})}")
        return bool(result.get("data"))

    wait_for("Jaeger received a StudyPilot trace", has_trace)

    def has_logs() -> bool:
        end = time.time_ns()
        start = end - 15 * 60 * 1_000_000_000
        query = urlencode({"query": LOG_SELECTOR, "limit": "20", "direction": "BACKWARD", "start": str(start), "end": str(end)})
        result = get_json(f"{LOKI}/loki/api/v1/query_range?{query}")
        streams = result.get("data", {}).get("result", [])
        return any(stream.get("values") for stream in streams)

    wait_for("Loki received StudyPilot JSON request logs", has_logs)
    print(f"Observability smoke check complete for {SERVICE}. Review the dashboard and trace in a browser before the live demo.")


if __name__ == "__main__":
    main()
