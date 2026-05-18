package dev.aegis.api.service;

import dev.aegis.common.model.IncidentDto;
import dev.aegis.common.model.RcaRequest;
import dev.aegis.common.model.RcaResponse;
import dev.aegis.common.model.SemanticSearchRequest;
import dev.aegis.common.model.SimilarIncident;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

@Component
public class AiEngineClient {
    private final WebClient webClient;

    public AiEngineClient(WebClient aiEngineWebClient) {
        this.webClient = aiEngineWebClient;
    }

    public Mono<Void> indexIncident(IncidentDto incident, List<String> logs, Map<String, Object> telemetry) {
        return webClient.post()
                .uri("/incidents/index")
                .bodyValue(new IndexIncidentRequest(incident, logs, telemetry))
                .retrieve()
                .bodyToMono(Void.class);
    }

    public Flux<SimilarIncident> search(SemanticSearchRequest request) {
        return webClient.post()
                .uri("/semantic-search")
                .bodyValue(request)
                .retrieve()
                .bodyToFlux(SimilarIncident.class);
    }

    public Mono<RcaResponse> generateRca(RcaRequest request) {
        return webClient.post()
                .uri("/rca")
                .bodyValue(request)
                .retrieve()
                .bodyToMono(RcaResponse.class);
    }

    record IndexIncidentRequest(IncidentDto incident, List<String> logs, Map<String, Object> telemetry) {
    }
}
