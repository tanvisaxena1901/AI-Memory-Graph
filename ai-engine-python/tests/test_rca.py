import asyncio

from models import RcaRequest
from rca_engine.generator import RcaGenerator


def test_deterministic_redis_rca():
    generator = RcaGenerator()
    response = asyncio.run(generator.generate(RcaRequest(query="Redis latency after deployment"), []))
    assert "Redis" in response.likelyRootCause


def test_deterministic_queue_lag_rca_uses_live_incident_signals():
    generator = RcaGenerator()
    response = asyncio.run(
        generator.generate(
            RcaRequest(
                query="\n".join(
                    [
                        "Operator question: what is happening right now and how do we fix it?",
                        "Incident ID: SYN-1002",
                        "Service: checkout-api",
                        "Deployment: v4.8",
                        "Incident summary: Checkout API timeout chain from consumer lag",
                    ]
                ),
                logs=[
                    "orders topic lag rising",
                    "checkout p95 latency crossed 2200ms",
                    "downstream timeout budget exhausted",
                ],
                telemetry={
                    "consumer_lag": 4366,
                    "queue_depth": 4780,
                    "p95_latency_ms": 2673,
                    "error_rate": 0.08,
                },
            ),
            [],
        )
    )

    assert "Consumer lag" in response.likelyRootCause
    assert "queue backlog" in response.summary
    assert response.remediation[0].startswith("Scale or recover the lagging consumers")


def test_deterministic_memory_rca_does_not_depend_on_literal_question_keywords():
    generator = RcaGenerator()
    response = asyncio.run(
        generator.generate(
            RcaRequest(
                query="\n".join(
                    [
                        "Operator question: what incident is active, where is it happening, and what should be fixed first?",
                        "Incident ID: SYN-2003",
                        "Service: inventory-worker",
                        "Deployment: v1.14",
                        "Incident summary: Inventory worker CrashLoopBackOff during sync job",
                    ]
                ),
                logs=[
                    "OOMKilled exit code 137",
                    "heap allocation increased after sync start",
                    "sync partition retries accumulating",
                ],
                telemetry={
                    "restart_count": 9,
                    "memory_percent": 97,
                    "queue_depth": 840,
                    "p95_latency_ms": 3100,
                },
            ),
            [],
        )
    )

    assert "memory pressure" in response.likelyRootCause.lower()
    assert any(item.startswith("telemetry restart_count=") for item in response.evidence)
    assert response.remediation[0].startswith("Check pod memory limits")
