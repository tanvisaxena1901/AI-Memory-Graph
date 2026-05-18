import asyncio

from models import RcaRequest
from rca_engine.generator import RcaGenerator


def test_deterministic_redis_rca():
    generator = RcaGenerator()
    response = asyncio.run(generator.generate(RcaRequest(query="Redis latency after deployment"), []))
    assert "Redis" in response.likelyRootCause
