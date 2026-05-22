package dev.aegis.api.controller;

import dev.aegis.api.service.AiEngineClient;
import dev.aegis.api.service.IncidentService;
import dev.aegis.common.model.BenchmarkReport;
import dev.aegis.common.model.CausalityGraph;
import dev.aegis.common.model.GraphTraversalRequest;
import dev.aegis.common.model.IncidentDto;
import dev.aegis.common.model.IncidentIngestRequest;
import dev.aegis.common.model.MemoryFeedbackRequest;
import dev.aegis.common.model.ReasoningTraceReplay;
import dev.aegis.common.model.RcaEvaluationReport;
import dev.aegis.common.model.RcaEvaluationRequest;
import dev.aegis.common.model.RcaRequest;
import dev.aegis.common.model.RcaResponse;
import dev.aegis.common.model.SemanticSearchRequest;
import dev.aegis.common.model.SimilarIncident;
import dev.aegis.common.model.TelemetryCausalityRequest;
import java.util.Map;
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

    @PostMapping("/memory/search")
    public Flux<SimilarIncident> memorySearch(@RequestBody SemanticSearchRequest request) {
        return aiEngineClient.searchMemory(request);
    }

    @PostMapping("/memory/feedback")
    public Mono<Map> memoryFeedback(@RequestBody MemoryFeedbackRequest request) {
        return aiEngineClient.recordFeedback(request);
    }

    @PostMapping("/rca")
    public Mono<RcaResponse> rca(@RequestBody RcaRequest request) {
        return aiEngineClient.generateRca(request);
    }

    @PostMapping("/rca/evaluate")
    public Mono<RcaEvaluationReport> evaluateRca(@RequestBody RcaEvaluationRequest request) {
        return aiEngineClient.evaluateRca(request);
    }

    @GetMapping("/benchmarks/incident-similarity")
    public Mono<BenchmarkReport> incidentSimilarityBenchmark(
            @RequestParam(defaultValue = "3") int k
    ) {
        return aiEngineClient.incidentSimilarityBenchmark(k);
    }

    @GetMapping("/graph/incidents")
    public Flux<Map> graphIncidents(
            @RequestParam(required = false) String service,
            @RequestParam String rootCause
    ) {
        return aiEngineClient.graphIncidents(service, rootCause);
    }

    @GetMapping("/graph/insights")
    public Mono<Map> graphInsights(@RequestParam(defaultValue = "default") String tenantId) {
        return aiEngineClient.graphInsights(tenantId);
    }

    @PostMapping("/graph/causality")
    public Mono<CausalityGraph> buildCausalityGraph(@RequestBody TelemetryCausalityRequest request) {
        return aiEngineClient.buildCausalityGraph(request);
    }

    @GetMapping("/graph/causality")
    public Mono<CausalityGraph> latestCausalityGraph(
            @RequestParam(required = false) String incidentId
    ) {
        return aiEngineClient.latestCausalityGraph(incidentId);
    }

    @PostMapping("/graph/traverse")
    public Mono<CausalityGraph> traverseGraph(@RequestBody GraphTraversalRequest request) {
        return aiEngineClient.traverseGraph(request);
    }

    @PostMapping("/memory/reembed")
    public Mono<Map> reembedMemory() {
        return aiEngineClient.reembedMemory();
    }

    @PostMapping("/memory/synthetic-dataset")
    public Mono<Map> syntheticDataset(@RequestParam(defaultValue = "60") int count) {
        return aiEngineClient.syntheticDataset(count);
    }

    @GetMapping("/evaluation/retrieval")
    public Mono<Map> retrievalEvaluation(@RequestParam(defaultValue = "5") int k) {
        return aiEngineClient.retrievalEvaluation(k);
    }

    @GetMapping("/audit/events")
    public Flux<Map> auditEvents() {
        return aiEngineClient.auditEvents();
    }

    @GetMapping("/rag/traces")
    public Flux<Map> ragTraces() {
        return aiEngineClient.ragTraces();
    }

    @GetMapping("/reasoning/traces/{traceId}/replay")
    public Mono<ReasoningTraceReplay> replayReasoningTrace(@PathVariable String traceId) {
        return aiEngineClient.replayReasoningTrace(traceId);
    }

    @GetMapping("/postmortems/{incidentId}")
    public Mono<Map> postmortem(
            @PathVariable String incidentId,
            @RequestParam(defaultValue = "default") String tenantId
    ) {
        return aiEngineClient.postmortem(incidentId, tenantId);
    }
}
