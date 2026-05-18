import logging

from config import settings
from models import Incident

log = logging.getLogger(__name__)


class GraphRepository:
    def __init__(self) -> None:
        self._driver = self._build_driver()

    def upsert_incident(self, incident: Incident) -> None:
        if self._driver is None:
            return
        query = """
        MERGE (svc:Service {name: $service})
        MERGE (inc:Incident {incidentId: $incidentId})
        SET inc.summary = $summary,
            inc.severity = $severity,
            inc.timestamp = datetime($timestamp),
            inc.deploymentVersion = $deploymentVersion
        MERGE (svc)-[:EXPERIENCED]->(inc)
        WITH inc
        FOREACH (_ IN CASE WHEN $deploymentVersion IS NULL THEN [] ELSE [1] END |
            MERGE (dep:Deployment {service: $service, version: $deploymentVersion})
            MERGE (dep)-[:PRECEDED]->(inc)
        )
        """
        try:
            with self._driver.session() as session:
                session.run(
                    query,
                    incidentId=incident.incidentId,
                    service=incident.service,
                    summary=incident.summary,
                    severity=incident.severity,
                    timestamp=incident.timestamp.isoformat(),
                    deploymentVersion=incident.deploymentVersion,
                )
        except Exception as exc:
            log.warning("neo4j_write_failed incidentId=%s reason=%s", incident.incidentId, exc)

    def _build_driver(self):
        try:
            from neo4j import GraphDatabase

            driver = GraphDatabase.driver(
                settings.neo4j_uri,
                auth=(settings.neo4j_user, settings.neo4j_password),
            )
            driver.verify_connectivity()
            return driver
        except Exception as exc:
            log.warning("neo4j_unavailable reason=%s", exc)
            return None
