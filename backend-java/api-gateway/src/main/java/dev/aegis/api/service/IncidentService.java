package dev.aegis.api.service;

import dev.aegis.api.persistence.IncidentEntity;
import dev.aegis.api.persistence.IncidentRepository;
import dev.aegis.common.model.IncidentDto;
import dev.aegis.common.model.IncidentIngestRequest;
import dev.aegis.common.model.IncidentSeverity;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

@Service
public class IncidentService {
    private static final Logger log = LoggerFactory.getLogger(IncidentService.class);

    private final IncidentRepository repository;
    private final AiEngineClient aiEngineClient;

    public IncidentService(IncidentRepository repository, AiEngineClient aiEngineClient) {
        this.repository = repository;
        this.aiEngineClient = aiEngineClient;
    }

    public Mono<IncidentDto> ingest(IncidentIngestRequest request) {
        IncidentEntity entity = new IncidentEntity();
        entity.setIncidentId(resolveIncidentId(request.incidentId()));
        entity.setTenantId(resolveDefault(request.tenantId(), "default"));
        entity.setTeamId(request.teamId());
        entity.setServiceOwner(request.serviceOwner());
        entity.setService(required(request.service(), "service"));
        entity.setSeverity(request.severity() == null ? IncidentSeverity.MEDIUM : request.severity());
        entity.setSummary(required(request.summary(), "summary"));
        entity.setDeploymentVersion(request.deploymentVersion());
        entity.setTimestamp(request.timestamp() == null ? Instant.now() : request.timestamp());
        entity.setRootCause(request.rootCause());
        entity.setRemediation(encodeRemediation(request.remediation()));
        entity.setSuccessfulRemediation(request.successfulRemediation());
        entity.setAiConfidence(request.aiConfidence());
        entity.setHumanConfirmed(request.humanConfirmed());
        entity.setRunbookRef(request.runbookRef());

        return repository.save(entity)
                .map(this::toDto)
                .flatMap(incident -> aiEngineClient.indexIncident(incident, request.logs(), request.telemetry())
                        .doOnError(error -> log.warn("ai_engine_index_failed incidentId={} message={}",
                                incident.incidentId(), error.getMessage()))
                        .onErrorResume(error -> Mono.empty())
                        .thenReturn(incident));
    }

    public Mono<IncidentDto> findById(String incidentId) {
        return repository.findById(incidentId).map(this::toDto);
    }

    public Flux<IncidentDto> findByService(String service) {
        return repository.findByServiceOrderByTimestampDesc(service).map(this::toDto);
    }

    private IncidentDto toDto(IncidentEntity entity) {
        return new IncidentDto(
                entity.getIncidentId(),
                entity.getTenantId(),
                entity.getTeamId(),
                entity.getServiceOwner(),
                entity.getService(),
                entity.getSeverity(),
                entity.getSummary(),
                entity.getDeploymentVersion(),
                entity.getTimestamp(),
                entity.getRootCause(),
                decodeRemediation(entity.getRemediation()),
                entity.getSuccessfulRemediation(),
                entity.getAiConfidence(),
                entity.getHumanConfirmed(),
                entity.getRunbookRef());
    }

    private static String resolveIncidentId(String incidentId) {
        if (incidentId == null || incidentId.isBlank()) {
            return "INC-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
        }
        return incidentId;
    }

    private static String required(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " is required");
        }
        return value;
    }

    private static String resolveDefault(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    private static String encodeRemediation(List<String> remediation) {
        if (remediation == null || remediation.isEmpty()) {
            return null;
        }
        return String.join("\n", remediation);
    }

    private static List<String> decodeRemediation(String remediation) {
        if (remediation == null || remediation.isBlank()) {
            return List.of();
        }
        return Arrays.stream(remediation.split("\\R"))
                .filter(value -> !value.isBlank())
                .toList();
    }
}
