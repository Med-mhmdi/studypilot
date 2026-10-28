import json
import logging
from io import StringIO

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.telemetry import request_metrics
from app.telemetry import configure_telemetry


def test_json_app_logs_are_written_to_stdout_and_file_once(tmp_path, monkeypatch):
    output = StringIO()
    monkeypatch.setattr("sys.stdout", output)
    monkeypatch.setenv("LOG_PATH", str(tmp_path / "app.jsonl"))
    monkeypatch.setenv("OTEL_ENABLED", "false")
    logger = logging.getLogger("studypilot")
    before = list(logger.handlers)
    for handler in before:
        logger.removeHandler(handler)

    try:
        configure_telemetry(FastAPI())
        configure_telemetry(FastAPI())
        logger.info("http_request method=GET route=/health status=200")

        stdout_rows = [json.loads(line) for line in output.getvalue().splitlines()]
        file_rows = [json.loads(line) for line in (tmp_path / "app.jsonl").read_text().splitlines()]
        assert stdout_rows[-1]["message"] == "http_request method=GET route=/health status=200"
        assert file_rows[-1] == stdout_rows[-1]
        assert sum(getattr(handler, "_studypilot_json_stdout", False) for handler in logger.handlers) == 1
    finally:
        for handler in list(logger.handlers):
            logger.removeHandler(handler)
            handler.close()
        for handler in before:
            logger.addHandler(handler)


class RecordingInstrument:
    def __init__(self):
        self.measurements = []

    def add(self, value, attributes=None):
        self.measurements.append((value, attributes))

    def record(self, value, attributes=None):
        self.measurements.append((value, attributes))


class RecordingMeter:
    def __init__(self):
        self.instruments = {}

    def create_counter(self, name, **_kwargs):
        return self._instrument(name)

    def create_histogram(self, name, **_kwargs):
        return self._instrument(name)

    def create_up_down_counter(self, name, **_kwargs):
        return self._instrument(name)

    def _instrument(self, name):
        self.instruments[name] = RecordingInstrument()
        return self.instruments[name]


def test_request_metrics_record_success_error_duration_and_in_flight(monkeypatch):
    from opentelemetry import metrics

    monkeypatch.setenv("OTEL_ENABLED", "true")
    meter = RecordingMeter()
    monkeypatch.setattr(metrics, "get_meter", lambda _name: meter)

    app = FastAPI()

    @app.get("/ok")
    def ok():
        return {"status": "ok"}

    @app.get("/broken")
    def broken():
        return JSONResponse(status_code=503, content={"status": "unavailable"})

    request_metrics(app)
    with TestClient(app) as client:
        assert client.get("/ok").status_code == 200
        assert client.get("/broken").status_code == 503

    requests = meter.instruments["studypilot.http.requests"].measurements
    durations = meter.instruments["studypilot.http.duration"].measurements
    errors = meter.instruments["studypilot.http.errors"].measurements
    in_flight = meter.instruments["studypilot.http.requests_in_flight"].measurements

    assert [attributes["http.response.status_code"] for _, attributes in requests] == [200, 503]
    assert [attributes["http.route"] for _, attributes in requests] == ["/ok", "/broken"]
    assert len(durations) == 2
    assert durations[0][0] >= 0
    assert [attributes["http.response.status_code"] for _, attributes in errors] == [503]
    assert [value for value, _ in in_flight] == [1, -1, 1, -1]
