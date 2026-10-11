"""Bounded process metrics; never retain user IDs, query strings or payloads."""
from collections import defaultdict
from threading import Lock

BUCKETS = (0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60)
_lock = Lock()
_metrics = defaultdict(lambda: {"count": 0, "sum": 0.0, "buckets": [0] * len(BUCKETS)})


def observe_request(method: str, route: str, status: int, duration: float) -> None:
    key = (method, route, f"{status // 100}xx")
    with _lock:
        if key not in _metrics and len(_metrics) >= 256:
            key = ("OTHER", "__other__", "other")
        metric = _metrics[key]
        metric["count"] += 1
        metric["sum"] += duration
        for index, limit in enumerate(BUCKETS):
            if duration <= limit:
                metric["buckets"][index] += 1


def prometheus_metrics() -> str:
    lines = ["# HELP ponto_request_duration_seconds HTTP request durations per process.",
             "# TYPE ponto_request_duration_seconds histogram"]
    with _lock:
        for (method, route, status), metric in sorted(_metrics.items()):
            route = route.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '')
            labels = f'method="{method}",route="{route}",status="{status}"'
            for index, limit in enumerate(BUCKETS):
                lines.append(f'ponto_request_duration_seconds_bucket{{{labels},le="{limit}"}} {metric["buckets"][index]}')
            lines.append(f'ponto_request_duration_seconds_bucket{{{labels},le="+Inf"}} {metric["count"]}')
            lines.append(f'ponto_request_duration_seconds_count{{{labels}}} {metric["count"]}')
            lines.append(f'ponto_request_duration_seconds_sum{{{labels}}} {metric["sum"]:.6f}')
    return "\n".join(lines) + "\n"
