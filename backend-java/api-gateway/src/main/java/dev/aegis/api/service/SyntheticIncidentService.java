package dev.aegis.api.service;

import dev.aegis.common.model.IncidentIngestRequest;
import dev.aegis.common.model.IncidentSeverity;
import dev.aegis.common.model.RcaRequest;
import dev.aegis.common.model.SemanticSearchRequest;
import dev.aegis.common.model.TelemetryCausalityRequest;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.stereotype.Service;

@Service
public class SyntheticIncidentService {
    private static final List<String> MEMORY_TYPES = List.of("episodic", "semantic", "procedural");

    private final List<IncidentTemplate> templates = List.of(
            new IncidentTemplate(
                    "payment-service",
                    "payments",
                    "payments-platform",
                    IncidentSeverity.HIGH,
                    "v2.3",
                    "Redis connection saturation after deployment",
                    "Redis pool saturation after connection reuse regression",
                    List.of("rollback payment-service v2.3", "increase Redis pool headroom", "drain retry backlog"),
                    Map.of("redis_latency_ms", 880, "error_rate", 0.18, "p95_latency_ms", 1850, "retry_rate", 42),
                    List.of("redis timeout after 500ms", "connection pool exhausted", "payment retries increased")),
            new IncidentTemplate(
                    "checkout-api",
                    "commerce",
                    "checkout-platform",
                    IncidentSeverity.MEDIUM,
                    "v4.8",
                    "Checkout API timeout chain from consumer lag",
                    "Kafka consumer lag propagated into synchronous checkout calls",
                    List.of("scale checkout consumers", "pause bulk import producer", "raise queue lag alert priority"),
                    Map.of("consumer_lag", 4300, "error_rate", 0.08, "p95_latency_ms", 2280, "queue_depth", 5200),
                    List.of("orders topic lag rising", "checkout p95 latency crossed 2200ms", "downstream timeout budget exhausted")),
            new IncidentTemplate(
                    "inventory-worker",
                    "supply-chain",
                    "inventory-platform",
                    IncidentSeverity.CRITICAL,
                    "v1.14",
                    "Inventory worker CrashLoopBackOff during sync job",
                    "Heap pressure from sync batch size caused repeated OOM kills",
                    List.of("reduce sync batch size", "increase worker memory limit", "restart failed partitions"),
                    Map.of("restart_count", 9, "memory_percent", 97, "queue_depth", 840, "p95_latency_ms", 3100),
                    List.of("OOMKilled exit code 137", "heap allocation increased after sync start", "sync partition retries accumulating")),
            new IncidentTemplate(
                    "notification-service",
                    "engagement",
                    "notification-platform",
                    IncidentSeverity.LOW,
                    "v3.2",
                    "Notification delivery degradation from provider throttling",
                    "External provider throttled burst traffic and increased send latency",
                    List.of("enable secondary provider", "rate-limit campaign sender", "replay delayed messages"),
                    Map.of("provider_latency_ms", 1460, "error_rate", 0.04, "queue_depth", 1200, "retry_rate", 15),
                    List.of("provider returned throttling responses", "delivery retries increased", "campaign batch exceeded normal rate"))
    );

    public SyntheticIncidentPayload nextIncident(String tenantId, String profile) {
        IncidentTemplate template = templates.get(ThreadLocalRandom.current().nextInt(templates.size()));
        Instant timestamp = Instant.now();
        String resolvedTenant = tenantId == null || tenantId.isBlank() ? "synthetic" : tenantId;
        String incidentId = "SYN-" + timestamp.toEpochMilli() + "-" + ThreadLocalRandom.current().nextInt(1000, 9999);
        Map<String, Object> telemetry = jitterTelemetry(template.telemetry());

        IncidentIngestRequest incident = new IncidentIngestRequest(
                incidentId,
                resolvedTenant,
                template.teamId(),
                template.owner(),
                template.service(),
                template.severity(),
                decorateSummary(template.summary(), profile),
                template.logs(),
                telemetry,
                template.deploymentVersion(),
                timestamp,
                template.rootCause(),
                template.remediation(),
                true,
                0.82,
                false,
                "runbooks/" + template.service());

        Map<String, Object> telemetryEvent = Map.of(
                "service", template.service(),
                "source", "synthetic-api",
                "timestamp", timestamp.toString(),
                "values", telemetry,
                "deploymentVersion", template.deploymentVersion());

        RcaRequest rca = new RcaRequest(
                incidentId,
                resolvedTenant,
                template.teamId(),
                "synthetic-api",
                "responder",
                incident.summary(),
                template.logs(),
                telemetry);

        SemanticSearchRequest memorySearch = new SemanticSearchRequest(
                incident.summary(),
                resolvedTenant,
                template.teamId(),
                "synthetic-api",
                "responder",
                template.service(),
                template.severity(),
                5,
                telemetry,
                MEMORY_TYPES);

        TelemetryCausalityRequest causality = new TelemetryCausalityRequest(
                incidentId,
                resolvedTenant,
                template.service(),
                template.deploymentVersion(),
                telemetry,
                template.logs(),
                List.of(
                        template.deploymentVersion() + " active for " + template.service(),
                        incident.summary(),
                        "Synthetic incident generated by API profile " + normalizeProfile(profile)),
                timestamp);

        return new SyntheticIncidentPayload(incidentId, resolvedTenant, normalizeProfile(profile), telemetryEvent, incident, rca, memorySearch, causality);
    }

    private Map<String, Object> jitterTelemetry(Map<String, Object> telemetry) {
        return telemetry.entrySet().stream()
                .collect(java.util.stream.Collectors.toMap(
                        Map.Entry::getKey,
                        entry -> jitterValue(entry.getValue())));
    }

    private Object jitterValue(Object value) {
        if (!(value instanceof Number number)) {
            return value;
        }
        double multiplier = 0.82 + ThreadLocalRandom.current().nextDouble(0.42);
        double result = number.doubleValue() * multiplier;
        if (value instanceof Integer || value instanceof Long) {
            return Math.round(result);
        }
        return Math.round(result * 100.0) / 100.0;
    }

    private String decorateSummary(String summary, String profile) {
        return summary + " [" + normalizeProfile(profile) + "]";
    }

    private String normalizeProfile(String profile) {
        return profile == null || profile.isBlank() ? "incident-management" : profile;
    }

    private record IncidentTemplate(
            String service,
            String teamId,
            String owner,
            IncidentSeverity severity,
            String deploymentVersion,
            String summary,
            String rootCause,
            List<String> remediation,
            Map<String, Object> telemetry,
            List<String> logs
    ) {
    }

    public record SyntheticIncidentPayload(
            String incidentId,
            String tenantId,
            String profile,
            Map<String, Object> telemetryEvent,
            IncidentIngestRequest incident,
            RcaRequest rca,
            SemanticSearchRequest memorySearch,
            TelemetryCausalityRequest causality
    ) {
    }
}
