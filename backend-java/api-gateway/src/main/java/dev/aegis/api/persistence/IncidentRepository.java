package dev.aegis.api.persistence;

import org.springframework.data.repository.reactive.ReactiveCrudRepository;
import reactor.core.publisher.Flux;

public interface IncidentRepository extends ReactiveCrudRepository<IncidentEntity, String> {
    Flux<IncidentEntity> findByServiceOrderByTimestampDesc(String service);
}
