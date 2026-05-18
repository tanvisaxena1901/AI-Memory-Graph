package dev.aegis.api.controller;

import dev.aegis.api.service.AiEngineClient;
import dev.aegis.api.service.IncidentService;
import dev.aegis.common.model.IncidentDto;
import dev.aegis.common.model.IncidentIngestRequest;
import dev.aegis.common.model.RcaRequest;
import dev.aegis.common.model.RcaResponse;
import dev.aegis.common.model.SemanticSearchRequest;
import dev.aegis.common.model.SimilarIncident;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

@RestController
@RequestMapping("/api/v1")
public class IncidentController {
    private final IncidentService incidentService;
    private final AiEngineClient aiEngineClient;

    public IncidentController(IncidentService incidentService, AiEngineClient aiEngineClient) {
        this.incidentService = incidentService;
        this.aiEngineClient = aiEngineClient;
    }

    @PostMapping("/incidents")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Mono<IncidentDto> ingest(@RequestBody IncidentIngestRequest request) {
        return incidentService.ingest(request);
    }

    @GetMapping("/incidents/{incidentId}")
    public Mono<IncidentDto> getIncident(@PathVariable String incidentId) {
        return incidentService.findById(incidentId);
    }

    @GetMapping("/incidents")
    public Flux<IncidentDto> listByService(@RequestParam String service) {
        return incidentService.findByService(service);
    }

    @PostMapping("/semantic-search")
    public Flux<SimilarIncident> semanticSearch(@RequestBody SemanticSearchRequest request) {
        return aiEngineClient.search(request);
    }

    @PostMapping("/rca")
    public Mono<RcaResponse> rca(@RequestBody RcaRequest request) {
        return aiEngineClient.generateRca(request);
    }
}
