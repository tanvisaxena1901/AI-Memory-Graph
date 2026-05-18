package dev.aegis.api.service;

import dev.aegis.api.persistence.IncidentEntity;
import dev.aegis.api.persistence.IncidentRepository;
import dev.aegis.common.model.IncidentDto;
import dev.aegis.common.model.IncidentIngestRequest;
import dev.aegis.common.model.IncidentSeverity;
import java.time.Instant;
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
        entity.setService(required(request.service(), "service"));
        entity.setSeverity(request.severity() == null ? IncidentSeverity.MEDIUM : request.severity());
        entity.setSummary(required(request.summary(), "summary"));
        entity.setDeploymentVersion(request.deploymentVersion());
        entity.setTimestamp(request.timestamp() == null ? Instant.now() : request.timestamp());

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
                entity.getService(),
                entity.getSeverity(),
                entity.getSummary(),
                entity.getDeploymentVersion(),
                entity.getTimestamp());
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
}
