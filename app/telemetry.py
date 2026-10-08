"""Optional OpenTelemetry setup; the assignment planner works without a collector."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path


def configure_telemetry(app) -> None:
    log_path = Path(os.getenv("LOG_PATH", "data/logs/studypilot.jsonl"))
    log_path.parent.mkdir(parents=True, exist_ok=True)

    class JsonFormatter(logging.Formatter):
        def format(self, record):
            return json.dumps({"level": record.levelname, "message": record.getMessage()})

    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setFormatter(JsonFormatter())
    app_logger = logging.getLogger("studypilot")
    app_logger.setLevel(logging.INFO)
    if not any(isinstance(handler, logging.FileHandler) and handler.baseFilename == str(log_path.resolve()) for handler in app_logger.handlers):
        app_logger.addHandler(file_handler)

    if os.getenv("OTEL_ENABLED", "false").lower() not in {"1", "true", "yes"}:
        return

    from opentelemetry import metrics
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.sqlite3 import SQLite3Instrumentor
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    provider = TracerProvider(
        resource=Resource.create({"service.name": os.getenv("OTEL_SERVICE_NAME", "studypilot")})
    )
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    metric_reader = PeriodicExportingMetricReader(OTLPMetricExporter(), export_interval_millis=5000)
    metrics.set_meter_provider(MeterProvider(resource=provider.resource, metric_readers=[metric_reader]))
    FastAPIInstrumentor.instrument_app(app)
    SQLite3Instrumentor().instrument()
    logging.getLogger(__name__).info("OpenTelemetry tracing enabled")


def request_metrics(app) -> None:
    if os.getenv("OTEL_ENABLED", "false").lower() not in {"1", "true", "yes"}:
        return
    from opentelemetry import metrics

    meter = metrics.get_meter("studypilot.http")
    request_count = meter.create_counter("studypilot.http.requests", unit="{request}")
    request_duration = meter.create_histogram("studypilot.http.duration", unit="s")

    @app.middleware("http")
    async def record_http_metrics(request, call_next):
        import time

        started = time.perf_counter()
        response = await call_next(request)
        route = request.scope.get("route")
        attributes = {
            "http.request.method": request.method,
            "http.route": getattr(route, "path", "unmatched"),
            "http.response.status_code": response.status_code,
        }
        request_count.add(1, attributes)
        request_duration.record(time.perf_counter() - started, attributes)
        logging.getLogger("studypilot").info(
            "http_request method=%s route=%s status=%s", request.method, attributes["http.route"], response.status_code
        )
        return response
