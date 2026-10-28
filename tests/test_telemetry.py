from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.telemetry import request_metrics


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
