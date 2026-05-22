package dev.aegis.api.service;

import dev.aegis.common.model.BenchmarkReport;
import dev.aegis.common.model.CausalityGraph;
import dev.aegis.common.model.GraphTraversalRequest;
import dev.aegis.common.model.IncidentDto;
import dev.aegis.common.model.MemoryFeedbackRequest;
import dev.aegis.common.model.ReasoningTraceReplay;
import dev.aegis.common.model.RcaEvaluationReport;
import dev.aegis.common.model.RcaEvaluationRequest;
import dev.aegis.common.model.RcaRequest;
import dev.aegis.common.model.RcaResponse;
import dev.aegis.common.model.SemanticSearchRequest;
import dev.aegis.common.model.SimilarIncident;
import dev.aegis.common.model.TelemetryCausalityRequest;
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

    public Flux<SimilarIncident> searchMemory(SemanticSearchRequest request) {
        return webClient.post()
                .uri("/api/v1/memory/search")
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

    public Mono<Map> recordFeedback(MemoryFeedbackRequest request) {
        return webClient.post()
                .uri("/api/v1/memory/feedback")
                .bodyValue(request)
                .retrieve()
                .bodyToMono(Map.class);
    }

    public Mono<RcaEvaluationReport> evaluateRca(RcaEvaluationRequest request) {
        return webClient.post()
                .uri("/api/v1/rca/evaluate")
                .bodyValue(request)
                .retrieve()
                .bodyToMono(RcaEvaluationReport.class);
    }

    public Mono<BenchmarkReport> incidentSimilarityBenchmark(int k) {
        return webClient.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/v1/benchmarks/incident-similarity")
                        .queryParam("k", k)
                        .build())
                .retrieve()
                .bodyToMono(BenchmarkReport.class);
    }

    public Flux<Map> graphIncidents(String service, String rootCause) {
        return webClient.get()
                .uri(uriBuilder -> {
                    var builder = uriBuilder
                            .path("/api/v1/graph/incidents")
                            .queryParam("rootCause", rootCause);
                    if (service != null && !service.isBlank()) {
                        builder.queryParam("service", service);
                    }
                    return builder.build();
                })
                .retrieve()
                .bodyToFlux(Map.class);
    }

    public Mono<Map> reembedMemory() {
        return postEmpty("/api/v1/memory/reembed");
    }

    public Mono<Map> syntheticDataset(int count) {
        return webClient.post()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/v1/memory/synthetic-dataset")
                        .queryParam("count", count)
                        .build())
                .retrieve()
                .bodyToMono(Map.class);
    }

    public Mono<Map> retrievalEvaluation(int k) {
        return webClient.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/v1/evaluation/retrieval")
                        .queryParam("k", k)
                        .build())
                .retrieve()
                .bodyToMono(Map.class);
    }

    public Flux<Map> auditEvents() {
        return webClient.get()
                .uri("/api/v1/audit/events")
                .retrieve()
                .bodyToFlux(Map.class);
    }

    public Flux<Map> ragTraces() {
        return webClient.get()
                .uri("/api/v1/rag/traces")
                .retrieve()
                .bodyToFlux(Map.class);
    }

    public Mono<Map> postmortem(String incidentId, String tenantId) {
        return webClient.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/v1/postmortems/{incidentId}")
                        .queryParam("tenantId", tenantId == null || tenantId.isBlank() ? "default" : tenantId)
                        .build(incidentId))
                .retrieve()
                .bodyToMono(Map.class);
    }

    public Mono<Map> graphInsights(String tenantId) {
        return webClient.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/v1/graph/insights")
                        .queryParam("tenantId", tenantId == null || tenantId.isBlank() ? "default" : tenantId)
                        .build())
                .retrieve()
                .bodyToMono(Map.class);
    }

    public Mono<CausalityGraph> buildCausalityGraph(TelemetryCausalityRequest request) {
        return webClient.post()
                .uri("/api/v1/graph/causality")
                .bodyValue(request)
                .retrieve()
                .bodyToMono(CausalityGraph.class);
    }

    public Mono<CausalityGraph> latestCausalityGraph(String incidentId) {
        return webClient.get()
                .uri(uriBuilder -> {
                    var builder = uriBuilder.path("/api/v1/graph/causality");
                    if (incidentId != null && !incidentId.isBlank()) {
                        builder.queryParam("incidentId", incidentId);
                    }
                    return builder.build();
                })
                .retrieve()
                .bodyToMono(CausalityGraph.class);
    }

    public Mono<CausalityGraph> traverseGraph(GraphTraversalRequest request) {
        return webClient.post()
                .uri("/api/v1/graph/traverse")
                .bodyValue(request)
                .retrieve()
                .bodyToMono(CausalityGraph.class);
    }

    public Mono<ReasoningTraceReplay> replayReasoningTrace(String traceId) {
        return webClient.get()
                .uri("/api/v1/reasoning/traces/{traceId}/replay", traceId)
                .retrieve()
                .bodyToMono(ReasoningTraceReplay.class);
    }

    private Mono<Map> postEmpty(String path) {
        return webClient.post()
                .uri(path)
                .retrieve()
                .bodyToMono(Map.class);
    }

    record IndexIncidentRequest(IncidentDto incident, List<String> logs, Map<String, Object> telemetry) {
    }
}
