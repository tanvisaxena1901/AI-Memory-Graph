import * as d3 from "d3";
import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Bot,
  CheckCircle2,
  Database,
  Gauge,
  GitBranch,
  Layers3,
  Network,
  Play,
  Radar,
  RefreshCw,
  Search,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  UserRound
} from "lucide-react";
import { apiUrl, telemetryApiUrl } from "./config";
import "./styles.css";

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type View = "metrics" | "incidents" | "memory" | "graph" | "workflows" | "reasoning";

type Incident = {
  incidentId: string;
  service: string;
  severity: Severity;
  summary: string;
  deploymentVersion: string;
  timestamp: string;
  logs: string[];
  telemetry: Record<string, number | string>;
  status: "Investigating" | "RCA ready" | "Acknowledged";
};

type RcaResult = {
  summary: string;
  likelyRootCause: string;
  evidence: string[];
  remediation: string[];
  confidence?: number;
  traceId?: string;
};

type ChatMessage = {
  id: string;
  role: "operator" | "aegis";
  content: string;
  timestamp: string;
};

type SearchResult = Incident & { score: number; reason: string };

type RemoteMemory = {
  incidentId: string;
  service: string;
  severity: Severity;
  summary: string;
  deploymentVersion?: string;
  timestamp: string;
  score: number;
  similarityScore: number;
  rankScore: number;
  memoryType: string;
  rootCause?: string;
  remediation?: string[];
  telemetrySignals?: Record<string, number | string>;
  rankingSignals?: Record<string, number>;
};

type SyntheticIncidentPayload = {
  incidentId: string;
  tenantId: string;
  profile: string;
  telemetryEvent: {
    service: string;
    source: string;
    timestamp: string;
    values: Record<string, number | string>;
    deploymentVersion: string;
  };
  incident: Omit<Incident, "status"> & {
    tenantId: string;
    teamId: string;
    serviceOwner: string;
    rootCause: string;
    remediation: string[];
    successfulRemediation: boolean;
    aiConfidence: number;
    humanConfirmed: boolean;
    runbookRef: string;
  };
  rca: {
    incidentId: string;
    tenantId: string;
    teamId: string;
    requestedBy: string;
    role: string;
    query: string;
    logs: string[];
    telemetry: Record<string, number | string>;
  };
  memorySearch: {
    query: string;
    tenantId: string;
    teamId: string;
    requestedBy: string;
    role: string;
    service: string;
    severity: Severity;
    limit: number;
    telemetry: Record<string, number | string>;
    memoryTypes: string[];
  };
  causality: {
    incidentId: string;
    tenantId: string;
    service: string;
    deploymentVersion: string;
    telemetry: Record<string, number | string>;
    logs: string[];
    events: string[];
    timestamp: string;
  };
};

type SyntheticDatasetReport = {
  status: string;
  generated: number;
  clusters: Record<string, number>;
};

type MetricSample = {
  id: string;
  service: string;
  source: string;
  timestamp: string;
  values: Record<string, number | string>;
  health: "Healthy" | "Warning" | "Critical";
};

type GraphNode = {
  id: string;
  label: string;
  kind: "deploy" | "deployment" | "metric" | "fault" | "incident" | "service" | "signal";
  x: number;
  y: number;
  detail: string;
  service?: string;
  severity?: string;
  score?: number;
};

type CausalityEdge = {
  source: string;
  target: string;
  relationship: string;
  weight: number;
  evidence: string[];
};

type CausalityGraphData = {
  incidentId?: string;
  tenantId: string;
  nodes: Array<Omit<GraphNode, "x" | "y">>;
  edges: CausalityEdge[];
  blastRadius: string[];
  recurringPatterns: string[];
  reasoningSummary: string;
};

type ReasoningEvent = {
  eventId: string;
  traceId: string;
  timestamp: string;
  step: string;
  incidentId?: string;
  service?: string;
  detail: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  durationMs: number;
  parentEventId?: string;
};

type ReasoningReplay = {
  traceId: string;
  events: ReasoningEvent[];
  workflowPath: string[];
  summary: string;
};

const initialIncidents: Incident[] = [
  {
    incidentId: "SYN-LOADING",
    service: "synthetic-api",
    severity: "LOW",
    summary: "Loading synthetic incident from API",
    deploymentVersion: "pending",
    timestamp: new Date().toISOString(),
    logs: ["Waiting for /api/v1/synthetic/incidents/next"],
    telemetry: {},
    status: "Investigating"
  }
];

const initialGraphNode: GraphNode = {
  id: "graph:synthetic-loading",
  label: "Awaiting graph",
  kind: "incident",
  x: 250,
  y: 160,
  detail: "Fetch synthetic data or build the causality graph to load API graph data."
};

const initialCausalityGraph: CausalityGraphData = {
  incidentId: "SYN-LOADING",
  tenantId: "synthetic",
  nodes: [
    {
      id: initialGraphNode.id,
      label: initialGraphNode.label,
      kind: initialGraphNode.kind,
      detail: initialGraphNode.detail
    }
  ],
  edges: [],
  blastRadius: [],
  recurringPatterns: [],
  reasoningSummary: "No local demo graph is loaded. Use Build Graph to call the causality API."
};

const initialReasoningReplay: ReasoningReplay = {
  traceId: "trace-awaiting-api",
  workflowPath: [],
  summary: "No reasoning replay has been loaded yet. Generate RCA to request a trace from the API.",
  events: []
};

const workflowSteps = [
  "Detect metric anomaly",
  "Collect logs",
  "Collect metrics",
  "Retrieve memory",
  "Analyze deployment",
  "Generate RCA"
];

const initialMetricSamples: MetricSample[] = [
  {
    id: "MET-1001",
    service: "payment-service",
    source: "otel-collector",
    timestamp: "2026-05-18T08:25:00.000Z",
    values: { p95_latency_ms: 1840, error_rate: 18, redis_latency_ms: 820 },
    health: "Critical"
  },
  {
    id: "MET-1002",
    service: "checkout-api",
    source: "prometheus",
    timestamp: "2026-05-18T08:23:00.000Z",
    values: { p95_latency_ms: 960, error_rate: 4, queue_lag: 620 },
    health: "Warning"
  }
];

function App() {
  const [activeView, setActiveView] = useState<View>("metrics");
  const [incidents, setIncidents] = useState(initialIncidents);
  const [metricSamples, setMetricSamples] = useState(initialMetricSamples);
  const [currentSyntheticPayload, setCurrentSyntheticPayload] = useState<SyntheticIncidentPayload | null>(null);
  const [syntheticDatasetReport, setSyntheticDatasetReport] = useState<SyntheticDatasetReport | null>(null);
  const [selectedId, setSelectedId] = useState(initialIncidents[0].incidentId);
  const [query, setQuery] = useState("Redis latency after deployment");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [rca, setRca] = useState<RcaResult>({
    summary: "Synthetic RCA has not been generated yet.",
    likelyRootCause: "Fetch synthetic data, then run RCA to call the AI engine.",
    evidence: [],
    remediation: ["Run RCA from the investigation context panel."]
  });
  const [status, setStatus] = useState("Dashboard loading synthetic data from API");
  const [selectedGraphNode, setSelectedGraphNode] = useState(initialGraphNode);
  const [causalityGraph, setCausalityGraph] = useState<CausalityGraphData>(initialCausalityGraph);
  const [reasoningReplay, setReasoningReplay] = useState<ReasoningReplay>(initialReasoningReplay);
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [workflowIndex, setWorkflowIndex] = useState(0);
  const [chatInput, setChatInput] = useState("What is the most likely root cause?");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "chat-initial",
      role: "aegis",
      content: "I am scoped to RCA for the selected incident. Ask about root cause, evidence, blast radius, or remediation.",
      timestamp: new Date().toISOString()
    }
  ]);
  const [collector, setCollector] = useState({
    service: "payment-service",
    source: "otel-collector",
    metrics: "p95_latency_ms=1840,error_rate=18,redis_latency_ms=820"
  });

  const selectedIncident = incidents.find((incident) => incident.incidentId === selectedId) ?? incidents[0];
  const services = Array.from(new Set([...incidents.map((incident) => incident.service), ...metricSamples.map((sample) => sample.service)]));
  const visibleIncidents = incidents.filter((incident) => {
    const matchesService = serviceFilter === "all" || incident.service === serviceFilter;
    const matchesQuery = tokenize(`${incident.summary} ${incident.logs.join(" ")}`).some((token) =>
      tokenize(query).includes(token)
    );
    return matchesService && (!query.trim() || matchesQuery || activeView !== "incidents");
  });

  const metrics = useMemo(
    () => [
      { label: "Services", value: services.length.toString(), icon: <Server size={18} />, tone: "teal" },
      {
        label: "Open incidents",
        value: incidents.filter((incident) => incident.status !== "Acknowledged").length.toString(),
        icon: <AlertTriangle size={18} />,
        tone: "red"
      },
      { label: "Metric samples", value: metricSamples.length.toString(), icon: <BarChart3 size={18} />, tone: "blue" },
      { label: "Memory hits", value: searchResults.length.toString(), icon: <Database size={18} />, tone: "amber" }
    ],
    [incidents, metricSamples.length, searchResults.length, services.length]
  );

  useEffect(() => {
    void loadSyntheticWorkflow();
    void seedSyntheticDataset(60);
  }, []);

  useEffect(() => {
    if (!workflowRunning) {
      return;
    }
    const timer = window.setInterval(() => {
      setWorkflowIndex((current) => {
        if (current >= workflowSteps.length - 1) {
          window.clearInterval(timer);
          setWorkflowRunning(false);
          setStatus("Incident investigation workflow completed");
          return current;
        }
        return current + 1;
      });
    }, 850);
    return () => window.clearInterval(timer);
  }, [workflowRunning]);

  useEffect(() => {
    setChatMessages([
      {
        id: `chat-context-${selectedIncident.incidentId}`,
        role: "aegis",
        content: `RCA context loaded for ${selectedIncident.incidentId}: ${selectedIncident.summary}`,
        timestamp: new Date().toISOString()
      }
    ]);
    setChatInput("What is the most likely root cause?");
  }, [selectedIncident.incidentId, selectedIncident.summary]);

  function selectIncident(incident: Incident) {
    setSelectedId(incident.incidentId);
    setRca({
      summary: "RCA has not been generated for this selected incident yet.",
      likelyRootCause: "Run RCA to call the AI engine with this incident context.",
      evidence: incident.logs.slice(0, 3),
      remediation: ["Run RCA from the investigation context panel."]
    });
    setStatus(`${incident.incidentId} selected for investigation`);
  }

  async function loadSyntheticWorkflow() {
    try {
      const response = await fetch(apiUrl("/api/v1/synthetic/incidents/next?tenantId=synthetic&profile=incident-management"));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as SyntheticIncidentPayload;
      const incident = mapSyntheticPayloadIncident(payload);
      setCurrentSyntheticPayload(payload);
      setIncidents((current) => [incident, ...current.filter((item) => item.incidentId !== incident.incidentId)]);
      setSelectedId(incident.incidentId);
      setCollector({
        service: payload.telemetryEvent.service,
        source: payload.telemetryEvent.source,
        metrics: formatTelemetryInput(payload.telemetryEvent.values)
      });
      const previewGraph = buildSyntheticGraphPreview(payload);
      setCausalityGraph(previewGraph);
      setSelectedGraphNode(previewGraph.nodes[0] ? { ...previewGraph.nodes[0], x: 0, y: 0 } : initialGraphNode);
      setQuery(payload.memorySearch.query);
      setSearchResults([]);
      setRca({
        summary: `Synthetic workflow loaded from ${payload.profile}.`,
        likelyRootCause: payload.incident.rootCause,
        evidence: payload.incident.logs,
        remediation: payload.incident.remediation
      });
      setStatus(`Loaded synthetic workflow ${payload.incidentId}`);
    } catch (error) {
      setStatus(`Synthetic API unavailable: ${errorMessage(error)}`);
    }
  }

  async function seedSyntheticDataset(count: number) {
    try {
      const response = await fetch(apiUrl(`/api/v1/memory/synthetic-dataset?count=${count}`), {
        method: "POST"
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      setSyntheticDatasetReport((await response.json()) as SyntheticDatasetReport);
    } catch (error) {
      setStatus(`Synthetic dataset seed failed: ${errorMessage(error)}`);
    }
  }

  async function runSearch() {
    const selectedTelemetry = selectedIncident.telemetry;
    const syntheticSearch =
      currentSyntheticPayload?.incidentId === selectedIncident.incidentId
        ? currentSyntheticPayload.memorySearch
        : null;
    try {
      const response = await fetch(apiUrl("/api/v1/memory/search"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(syntheticSearch ?? {
            query,
            tenantId: "synthetic",
            teamId: "dashboard",
            requestedBy: "dashboard",
            role: "platform-admin",
            service: serviceFilter === "all" ? selectedIncident.service : serviceFilter,
            severity: selectedIncident.severity,
            limit: 6,
            telemetry: selectedTelemetry,
            memoryTypes: ["episodic", "semantic", "procedural"]
          }),
          role: "platform-admin",
          limit: 6
        })
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const remote = (await response.json()) as RemoteMemory[];
      let mapped = remote.map(mapRemoteMemory);
      if (mapped.length === 0 && (syntheticSearch?.service || selectedIncident.service)) {
        const broadResponse = await fetch(apiUrl("/api/v1/memory/search"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: syntheticSearch?.query ?? query,
            tenantId: "synthetic",
            teamId: syntheticSearch?.teamId ?? "dashboard",
            requestedBy: "dashboard",
            role: "platform-admin",
            service: null,
            severity: selectedIncident.severity,
            limit: 6,
            telemetry: selectedTelemetry,
            memoryTypes: ["episodic", "semantic", "procedural"]
          })
        });
        if (!broadResponse.ok) {
          throw new Error(`HTTP ${broadResponse.status}`);
        }
        mapped = ((await broadResponse.json()) as RemoteMemory[]).map(mapRemoteMemory);
      }
      setSearchResults(mapped);
      setActiveView("memory");
      setStatus(`API retrieval returned ${mapped.length} memories for ${selectedIncident.incidentId}`);
      return;
    } catch (error) {
      setSearchResults([]);
      setActiveView("memory");
      setStatus(`Retrieval API failed: ${errorMessage(error)}`);
    }
  }

  async function collectMetricSample(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const values = parseTelemetry(collector.metrics);
    const health = metricHealth(values);
    const sample: MetricSample = {
      id: `MET-${Math.floor(1000 + Math.random() * 9000)}`,
      service: collector.service.trim() || "unknown-service",
      source: collector.source.trim() || "manual-collector",
      timestamp: new Date().toISOString(),
      values,
      health
    };

    try {
      const response = await fetch(telemetryApiUrl("/api/v1/telemetry"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sample)
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const accepted = await response.json();
      setStatus(`${sample.id} collected through telemetry service at ${new Date(accepted.acceptedAt).toLocaleTimeString()}`);
    } catch (error) {
      setStatus(`Collect metrics failed: ${errorMessage(error)}`);
      return;
    }

    setMetricSamples((current) => [sample, ...current]);
    if (sample.health !== "Healthy") {
      openIncidentFromMetrics(sample);
    }
  }

  function openIncidentFromMetrics(sample: MetricSample) {
    const created: Incident = {
      incidentId: `INC-${Math.floor(1000 + Math.random() * 9000)}`,
      service: sample.service,
      severity: sample.health === "Critical" ? "HIGH" : "MEDIUM",
      summary: `${sample.service} metric anomaly detected by ${sample.source}`,
      deploymentVersion: "observed",
      timestamp: new Date().toISOString(),
      logs: [`${sample.source} reported ${sample.health.toLowerCase()} metrics`, ...Object.entries(sample.values).map(([key, value]) => `${key}=${value}`)],
      telemetry: sample.values,
      status: "Investigating"
    };
    setIncidents((current) => [created, ...current]);
    setSelectedId(created.incidentId);
    setRca({
      summary: "Incident opened from collected telemetry.",
      likelyRootCause: "Run RCA to call the AI engine with this metric-derived incident.",
      evidence: created.logs,
      remediation: ["Run RCA from the investigation context panel."]
    });
    setStatus(`${sample.id} collected through telemetry service; ${created.incidentId} opened`);
    setActiveView("incidents");
  }

  async function generateRca() {
    const syntheticRca =
      currentSyntheticPayload?.incidentId === selectedIncident.incidentId
        ? { ...currentSyntheticPayload.rca, requestedBy: "dashboard", role: "platform-admin" }
        : null;
    try {
      const response = await fetch(apiUrl("/api/v1/rca"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(syntheticRca ?? {
          incidentId: selectedIncident.incidentId,
          tenantId: "synthetic",
          teamId: "dashboard",
          requestedBy: "dashboard",
          role: "responder",
          query: buildRcaQuery(selectedIncident, "What is happening, what is the likely root cause, and what should be fixed first?"),
          logs: selectedIncident.logs,
          telemetry: selectedIncident.telemetry
        })
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const remote = (await response.json()) as RcaResult;
      setRca(remote);
      if (remote.traceId) {
        await loadReasoningReplay(remote.traceId);
      }
      setStatus(`RCA generated by AI engine for ${selectedIncident.incidentId}`);
    } catch (error) {
      setRca({
        summary: "RCA API call failed.",
        likelyRootCause: "No RCA generated because the API request failed.",
        evidence: [errorMessage(error)],
        remediation: ["Check the API gateway and AI engine logs, then retry Run RCA."]
      });
      setStatus(`RCA API failed: ${errorMessage(error)}`);
    }
    setIncidents((current) =>
      current.map((incident) =>
        incident.incidentId === selectedIncident.incidentId ? { ...incident, status: "RCA ready" } : incident
      )
    );
  }

  async function buildCausalityGraph() {
    const syntheticCausality =
      currentSyntheticPayload?.incidentId === selectedIncident.incidentId
        ? currentSyntheticPayload.causality
        : null;
    try {
      const response = await fetch(apiUrl("/api/v1/graph/causality"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(syntheticCausality ?? {
          incidentId: selectedIncident.incidentId,
          tenantId: "synthetic",
          service: selectedIncident.service,
          deploymentVersion: selectedIncident.deploymentVersion,
          telemetry: selectedIncident.telemetry,
          logs: selectedIncident.logs,
          events: [
            `${selectedIncident.deploymentVersion} active for ${selectedIncident.service}`,
            `${selectedIncident.status} status`,
            selectedIncident.summary
          ],
          timestamp: selectedIncident.timestamp
        })
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const graph = normalizeCausalityGraph((await response.json()) as CausalityGraphData);
      setCausalityGraph(graph);
      setSelectedGraphNode(graph.nodes[0] ? { ...graph.nodes[0], x: 0, y: 0 } : initialGraphNode);
      setActiveView("graph");
      setStatus(`Causality graph built for ${selectedIncident.incidentId}`);
    } catch (error) {
      setActiveView("graph");
      setStatus(`Graph API failed: ${errorMessage(error)}`);
    }
  }

  async function loadReasoningReplay(traceId: string) {
    try {
      const response = await fetch(apiUrl(`/api/v1/reasoning/traces/${traceId}/replay`));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      setReasoningReplay((await response.json()) as ReasoningReplay);
      setActiveView("reasoning");
    } catch {
      setReasoningReplay(initialReasoningReplay);
    }
  }

  async function askRcaAssistant(event?: React.FormEvent<HTMLFormElement>, suggestedQuestion?: string) {
    event?.preventDefault();
    const question = (suggestedQuestion ?? chatInput).trim();
    if (!question || chatBusy) {
      return;
    }

    const operatorMessage: ChatMessage = {
      id: `operator-${Date.now()}`,
      role: "operator",
      content: question,
      timestamp: new Date().toISOString()
    };
    setChatMessages((current) => [...current, operatorMessage]);
    setChatInput("");
    setChatBusy(true);

    try {
      if (isGreeting(question)) {
        setChatMessages((current) => [
          ...current,
          {
            id: `aegis-${Date.now()}`,
            role: "aegis",
            content: `Incident ${selectedIncident.incidentId} is active on ${selectedIncident.service} (${selectedIncident.deploymentVersion}). Current issue: ${selectedIncident.summary}. Ask about evidence, fix steps, blast radius, or similar incidents.`,
            timestamp: new Date().toISOString()
          }
        ]);
        setStatus(`RCA chat summarized ${selectedIncident.incidentId}`);
        return;
      }

      if (asksForSimilarIncidents(question)) {
        const similarIncidents = await fetchSimilarIncidents(selectedIncident, currentSyntheticPayload);
        setChatMessages((current) => [
          ...current,
          {
            id: `aegis-${Date.now()}`,
            role: "aegis",
            content: formatSimilarIncidentsAnswer(selectedIncident, similarIncidents),
            timestamp: new Date().toISOString()
          }
        ]);
        setStatus(`RCA chat retrieved similar incidents for ${selectedIncident.incidentId}`);
        return;
      }

      const syntheticRca =
        currentSyntheticPayload?.incidentId === selectedIncident.incidentId
          ? { ...currentSyntheticPayload.rca, requestedBy: "dashboard", role: "platform-admin" }
          : null;
      const response = await fetch(apiUrl("/api/v1/rca"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(syntheticRca ?? {
            incidentId: selectedIncident.incidentId,
            tenantId: "synthetic",
            teamId: "dashboard",
            requestedBy: "dashboard",
            role: "responder",
            logs: selectedIncident.logs,
            telemetry: selectedIncident.telemetry
          }),
          incidentId: selectedIncident.incidentId,
          query: buildRcaQuery(selectedIncident, question),
        })
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const remote = (await response.json()) as RcaResult;
      setRca(remote);
      setChatMessages((current) => [
        ...current,
        {
          id: `aegis-${Date.now()}`,
          role: "aegis",
          content: formatRcaChatAnswer(question, selectedIncident, remote),
          timestamp: new Date().toISOString()
        }
      ]);
      setStatus(`RCA chat answered by AI engine for ${selectedIncident.incidentId}`);
    } catch (error) {
      setChatMessages((current) => [
        ...current,
        {
          id: `aegis-${Date.now()}`,
          role: "aegis",
          content: `RCA API failed: ${errorMessage(error)}`,
          timestamp: new Date().toISOString()
        }
      ]);
      setStatus(`RCA chat API failed for ${selectedIncident.incidentId}`);
    } finally {
      setChatBusy(false);
    }
  }

  function acknowledgeIncident() {
    setIncidents((current) =>
      current.map((incident) =>
        incident.incidentId === selectedIncident.incidentId ? { ...incident, status: "Acknowledged" } : incident
      )
    );
    setStatus(`${selectedIncident.incidentId} acknowledged`);
  }

  function startWorkflow() {
    setWorkflowIndex(0);
    setWorkflowRunning(true);
    setActiveView("workflows");
    setStatus(`Workflow queued for ${selectedIncident.incidentId}`);
  }

  return (
    <main className="min-h-screen bg-[#f4f7f9] text-graphite">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-11 w-11 place-items-center rounded bg-graphite text-white shadow-sm">
              <Radar size={22} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-normal">AEGIS</h1>
              <p className="text-sm text-slate-500">Autonomous Execution, Graph Intelligence and Stateful Runtime</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label={status} />
            <ActionButton icon={<Gauge size={16} />} label="Collect Metrics" onClick={() => setActiveView("metrics")} />
            <ActionButton icon={<Network size={16} />} label="Build Graph" onClick={buildCausalityGraph} />
            <ActionButton icon={<Play size={16} />} label="Start Workflow" onClick={startWorkflow} />
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-4 px-5 py-5 md:grid-cols-4">
        {metrics.map((metric) => (
          <Metric key={metric.label} {...metric} />
        ))}
      </section>

      <section className="mx-auto max-w-7xl px-5">
        <div className="flex flex-wrap gap-2 border-b border-slate-200">
          <NavButton active={activeView === "metrics"} icon={<Gauge size={16} />} label="Metrics" onClick={() => setActiveView("metrics")} />
          <NavButton active={activeView === "incidents"} icon={<Bell size={16} />} label="Incidents" onClick={() => setActiveView("incidents")} />
          <NavButton active={activeView === "memory"} icon={<Database size={16} />} label="Memory Search" onClick={() => setActiveView("memory")} />
          <NavButton active={activeView === "graph"} icon={<Network size={16} />} label="Graph" onClick={() => setActiveView("graph")} />
          <NavButton active={activeView === "workflows"} icon={<Layers3 size={16} />} label="Workflows" onClick={() => setActiveView("workflows")} />
          <NavButton active={activeView === "reasoning"} icon={<Bot size={16} />} label="Reasoning" onClick={() => setActiveView("reasoning")} />
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-5">
          {activeView === "metrics" && (
            <>
              <SyntheticDataPanel
                payload={currentSyntheticPayload}
                report={syntheticDatasetReport}
              />
              <MetricCollectorPanel
                collector={collector}
                metricSamples={metricSamples}
                setCollector={setCollector}
                onCollect={collectMetricSample}
                onOpenIncident={openIncidentFromMetrics}
              />
            </>
          )}

          {activeView === "incidents" && (
            <Panel title="Detected Incidents" action={<ActionButton icon={<RefreshCw size={16} />} label="Run Search" onClick={runSearch} />}>
              <div className="grid gap-3 border-b border-slate-100 p-4 md:grid-cols-[1fr_180px]">
                <label className="relative block">
                  <Search className="absolute left-3 top-3 text-slate-400" size={18} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="h-11 w-full rounded border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-signal focus:ring-2 focus:ring-emerald-100"
                    placeholder="Search detected incidents"
                  />
                </label>
                <select
                  value={serviceFilter}
                  onChange={(event) => setServiceFilter(event.target.value)}
                  className="h-11 rounded border border-slate-200 bg-white px-3 text-sm outline-none focus:border-signal focus:ring-2 focus:ring-emerald-100"
                >
                  <option value="all">All services</option>
                  {services.map((service) => (
                    <option key={service} value={service}>{service}</option>
                  ))}
                </select>
              </div>
              <div className="divide-y divide-slate-100">
                {visibleIncidents.map((incident) => (
                  <IncidentRow
                    key={incident.incidentId}
                    incident={incident}
                    active={incident.incidentId === selectedIncident.incidentId}
                    onSelect={() => selectIncident(incident)}
                  />
                ))}
              </div>
            </Panel>
          )}

          {activeView === "memory" && (
            <Panel title="Semantic Memory Retrieval" action={<ActionButton icon={<Search size={16} />} label="Run Retrieval" onClick={runSearch} />}>
              <div className="p-4">
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="h-11 rounded border border-slate-200 px-3 text-sm outline-none focus:border-signal focus:ring-2 focus:ring-emerald-100"
                    placeholder="Redis latency after deployment"
                  />
                  <ActionButton icon={<Sparkles size={16} />} label="Correlate" onClick={runSearch} />
                </div>
                <div className="mt-4 grid gap-3">
                  {(searchResults.length ? searchResults : incidents.map((incident) => scoreIncident(incident, query))).map((result) => (
                    <button
                      key={result.incidentId}
                      onClick={() => selectIncident(result)}
                      className="rounded border border-slate-200 bg-white p-4 text-left transition hover:border-signal hover:shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-mono text-xs text-slate-500">{result.incidentId}</div>
                          <div className="mt-1 text-sm font-semibold">{result.summary}</div>
                          <div className="mt-1 text-xs text-slate-500">{result.reason}</div>
                        </div>
                        <div className="rounded bg-emerald-50 px-2 py-1 font-mono text-sm text-signal">{result.score.toFixed(2)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </Panel>
          )}

          {activeView === "graph" && (
            <Panel title="Telemetry Causality Graph" action={<ActionButton icon={<GitBranch size={16} />} label="Build Graph" onClick={buildCausalityGraph} />}>
              <div className="grid gap-4 p-4 lg:grid-cols-[1fr_240px]">
                <D3CausalityGraph
                  graph={causalityGraph}
                  selectedId={selectedGraphNode.id}
                  onSelect={(node) => setSelectedGraphNode({ ...node, x: 0, y: 0 })}
                />
                <div className="rounded border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{selectedGraphNode.kind}</div>
                  <div className="mt-2 text-lg font-semibold">{selectedGraphNode.label}</div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{selectedGraphNode.detail}</p>
                  <div className="mt-4 grid gap-2 text-xs text-slate-600">
                    <div className="rounded bg-white px-3 py-2">Blast radius: {causalityGraph.blastRadius.join(", ") || "none"}</div>
                    <div className="rounded bg-white px-3 py-2">Patterns: {causalityGraph.recurringPatterns.join(", ") || "none"}</div>
                  </div>
                  <button
                    onClick={generateRca}
                    className="mt-4 inline-flex h-10 items-center gap-2 rounded bg-graphite px-3 text-sm font-medium text-white transition hover:bg-slate-700"
                  >
                    <Sparkles size={16} />
                    Generate RCA
                  </button>
                </div>
              </div>
              <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
                {causalityGraph.reasoningSummary}
              </div>
            </Panel>
          )}

          {activeView === "workflows" && (
            <Panel title="Incident Investigation Workflow" action={<ActionButton icon={<Play size={16} />} label={workflowRunning ? "Running" : "Run Workflow"} onClick={startWorkflow} />}>
              <div className="grid gap-3 p-4">
                {workflowSteps.map((step, index) => (
                  <div key={step} className="flex items-center gap-3">
                    <div className={`grid h-8 w-8 place-items-center rounded-full border ${index <= workflowIndex ? "border-signal bg-emerald-50 text-signal" : "border-slate-200 bg-white text-slate-400"}`}>
                      {index < workflowIndex ? <CheckCircle2 size={16} /> : index === workflowIndex && workflowRunning ? <Activity size={16} className="animate-spin" /> : index + 1}
                    </div>
                    <div className="flex-1 rounded border border-slate-200 bg-white px-3 py-2 text-sm">{step}</div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {activeView === "reasoning" && (
            <ReasoningReplayPanel
              replay={reasoningReplay}
              onReplay={() => {
                const traceId = rca.traceId ?? reasoningReplay.traceId;
                void loadReasoningReplay(traceId);
              }}
            />
          )}
        </div>

        <div className="space-y-5">
          <Panel
            title="Investigation Context"
            action={<ActionButton icon={<Send size={16} />} label="RCA" onClick={generateRca} />}
          >
            <div className="space-y-4 p-4">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-sm text-slate-500">{selectedIncident.incidentId}</div>
                    <h2 className="mt-1 text-lg font-semibold">{selectedIncident.summary}</h2>
                  </div>
                  <SeverityBadge severity={selectedIncident.severity} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-600">
                  <Detail label="Service" value={selectedIncident.service} />
                  <Detail label="Version" value={selectedIncident.deploymentVersion} />
                </div>
              </div>
              <div className="grid gap-2">
                {Object.entries(selectedIncident.telemetry).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <span className="text-slate-500">{key}</span>
                    <span className="font-mono font-semibold">{String(value)}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <ActionButton icon={<Sparkles size={16} />} label="Generate RCA" onClick={generateRca} />
                <ActionButton icon={<Network size={16} />} label="Causality Graph" onClick={buildCausalityGraph} />
                <ActionButton icon={<CheckCircle2 size={16} />} label="Acknowledge" onClick={acknowledgeIncident} />
                <ActionButton icon={<Play size={16} />} label="Workflow" onClick={startWorkflow} />
                <ActionButton icon={<Bot size={16} />} label="Trace Replay" onClick={() => setActiveView("reasoning")} />
              </div>
            </div>
          </Panel>

          <RcaChatPanel
            busy={chatBusy}
            input={chatInput}
            incident={selectedIncident}
            messages={chatMessages}
            onAsk={askRcaAssistant}
            onInputChange={setChatInput}
          />
        </div>
      </section>
    </main>
  );
}

function Panel(props: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded border border-slate-200 bg-white shadow-sm">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-semibold">{props.title}</h2>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

function Metric(props: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  const tones: Record<string, string> = {
    teal: "border-emerald-200 bg-emerald-50 text-signal",
    red: "border-red-200 bg-red-50 text-fault",
    blue: "border-sky-200 bg-sky-50 text-sky-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700"
  };
  return (
    <div className="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`inline-flex h-9 w-9 items-center justify-center rounded border ${tones[props.tone]}`}>{props.icon}</div>
      <div className="mt-4 text-2xl font-semibold">{props.value}</div>
      <div className="mt-1 text-sm text-slate-500">{props.label}</div>
    </div>
  );
}

function ActionButton(props: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="inline-flex h-10 items-center gap-2 rounded border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-signal hover:bg-emerald-50 hover:text-signal active:scale-[0.99]"
    >
      {props.icon}
      {props.label}
    </button>
  );
}

function NavButton(props: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition ${
        props.active ? "border-signal text-signal" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
      }`}
    >
      {props.icon}
      {props.label}
    </button>
  );
}

function IncidentRow(props: { incident: Incident; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onSelect}
      className={`grid w-full gap-3 px-4 py-4 text-left transition md:grid-cols-[110px_1fr_120px_110px] ${
        props.active ? "bg-emerald-50" : "bg-white hover:bg-slate-50"
      }`}
    >
      <div className="font-mono text-sm text-slate-600">{props.incident.incidentId}</div>
      <div>
        <div className="text-sm font-semibold">{props.incident.summary}</div>
        <div className="mt-1 text-sm text-slate-500">{props.incident.service} | {props.incident.deploymentVersion}</div>
      </div>
      <SeverityBadge severity={props.incident.severity} />
      <div className="text-sm text-slate-500">{props.incident.status}</div>
    </button>
  );
}

function SeverityBadge(props: { severity: Severity }) {
  const classes: Record<Severity, string> = {
    LOW: "border-slate-200 bg-slate-50 text-slate-600",
    MEDIUM: "border-amber-200 bg-amber-50 text-amber-700",
    HIGH: "border-red-200 bg-red-50 text-red-700",
    CRITICAL: "border-fault bg-red-600 text-white"
  };
  return <span className={`inline-flex h-7 items-center justify-center rounded border px-2 text-xs font-semibold ${classes[props.severity]}`}>{props.severity}</span>;
}

function StatusPill(props: { label: string; compact?: boolean }) {
  return (
    <div className={`inline-flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 text-sm text-emerald-800 ${props.compact ? "px-2 py-1" : "px-3 py-2"}`}>
      <Activity size={14} />
      <span className="truncate">{props.label}</span>
    </div>
  );
}

function Detail(props: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{props.label}</div>
      <div className="mt-1 truncate font-medium">{props.value}</div>
    </div>
  );
}

function RcaChatPanel(props: {
  busy: boolean;
  input: string;
  incident: Incident;
  messages: ChatMessage[];
  onAsk: (event?: React.FormEvent<HTMLFormElement>, suggestedQuestion?: string) => void;
  onInputChange: (value: string) => void;
}) {
  const suggestions = [
    "What evidence supports this RCA?",
    "What changed recently?",
    "What should I do first?"
  ];
  return (
    <Panel title="RCA Chat" action={<StatusPill label={props.busy ? "Reasoning" : props.incident.incidentId} compact />}>
      <div className="space-y-3 p-4">
        <div className="max-h-80 space-y-3 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-3">
          {props.messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-2 ${message.role === "operator" ? "justify-end" : "justify-start"}`}
            >
              {message.role === "aegis" && (
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded bg-graphite text-white">
                  <Bot size={16} />
                </div>
              )}
              <div
                className={`max-w-[82%] rounded px-3 py-2 text-sm leading-6 ${
                  message.role === "operator"
                    ? "bg-signal text-white"
                    : "border border-slate-200 bg-white text-slate-700"
                }`}
              >
                {message.content}
              </div>
              {message.role === "operator" && (
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded border border-slate-200 bg-white text-slate-600">
                  <UserRound size={16} />
                </div>
              )}
            </div>
          ))}
          {props.busy && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Activity size={16} className="animate-spin" />
              RCA engine is analyzing incident context
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => props.onAsk(undefined, suggestion)}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 transition hover:border-signal hover:text-signal"
            >
              {suggestion}
            </button>
          ))}
        </div>
        <form onSubmit={props.onAsk} className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            value={props.input}
            onChange={(event) => props.onInputChange(event.target.value)}
            className="h-10 rounded border border-slate-200 px-3 text-sm outline-none focus:border-signal focus:ring-2 focus:ring-emerald-100"
            placeholder="Ask about root cause, evidence, blast radius, or remediation"
          />
          <button
            disabled={props.busy}
            className="inline-flex h-10 items-center justify-center gap-2 rounded bg-graphite px-4 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send size={16} />
            Ask
          </button>
        </form>
      </div>
    </Panel>
  );
}

function MetricCollectorPanel(props: {
  collector: {
    service: string;
    source: string;
    metrics: string;
  };
  metricSamples: MetricSample[];
  setCollector: React.Dispatch<React.SetStateAction<{
    service: string;
    source: string;
    metrics: string;
  }>>;
  onCollect: (event?: React.FormEvent<HTMLFormElement>) => void;
  onOpenIncident: (sample: MetricSample) => void;
}) {
  return (
    <Panel title="Metrics Collection" action={<StatusPill label="Telemetry first" compact />}>
      <form onSubmit={props.onCollect} className="grid gap-3 border-b border-slate-100 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Input label="Service" value={props.collector.service} onChange={(value) => props.setCollector((collector) => ({ ...collector, service: value }))} />
          <Input label="Collector Source" value={props.collector.source} onChange={(value) => props.setCollector((collector) => ({ ...collector, source: value }))} />
        </div>
        <Input label="Metric Payload" value={props.collector.metrics} onChange={(value) => props.setCollector((collector) => ({ ...collector, metrics: value }))} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <ShieldCheck size={16} className="text-signal" />
            Thresholds open incidents only when collected metrics are unhealthy.
          </div>
          <button className="inline-flex h-10 items-center gap-2 rounded bg-graphite px-4 text-sm font-medium text-white transition hover:bg-slate-700">
            <Gauge size={16} />
            Collect Metrics
          </button>
        </div>
      </form>
      <div className="grid gap-3 p-4">
        {props.metricSamples.map((sample) => (
          <MetricSampleRow key={sample.id} sample={sample} onOpenIncident={() => props.onOpenIncident(sample)} />
        ))}
      </div>
    </Panel>
  );
}

function MetricSampleRow(props: { sample: MetricSample; onOpenIncident: () => void }) {
  const healthClass = {
    Healthy: "border-emerald-200 bg-emerald-50 text-emerald-800",
    Warning: "border-amber-200 bg-amber-50 text-amber-800",
    Critical: "border-red-200 bg-red-50 text-red-800"
  }[props.sample.health];
  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-slate-500">{props.sample.id}</div>
          <div className="mt-1 text-sm font-semibold">{props.sample.service}</div>
          <div className="mt-1 text-xs text-slate-500">{props.sample.source} | {new Date(props.sample.timestamp).toLocaleTimeString()}</div>
        </div>
        <span className={`rounded border px-2 py-1 text-xs font-semibold ${healthClass}`}>{props.sample.health}</span>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {Object.entries(props.sample.values).map(([key, value]) => (
          <div key={key} className="rounded bg-slate-50 px-3 py-2">
            <div className="text-xs text-slate-500">{key}</div>
            <div className="mt-1 font-mono text-sm font-semibold">{String(value)}</div>
          </div>
        ))}
      </div>
      {props.sample.health !== "Healthy" && (
        <button
          type="button"
          onClick={props.onOpenIncident}
          className="mt-3 inline-flex h-9 items-center gap-2 rounded border border-red-200 bg-red-50 px-3 text-sm font-medium text-red-700 transition hover:bg-red-100"
        >
          <AlertTriangle size={16} />
          Open Incident From Metrics
        </button>
      )}
    </div>
  );
}

function SyntheticDataPanel(props: {
  payload: SyntheticIncidentPayload | null;
  report: SyntheticDatasetReport | null;
}) {
  return (
    <Panel title="Synthetic Data Source">
      <div className="grid gap-3 p-4">
        <Detail label="Current incident" value={props.payload?.incidentId ?? "not loaded"} />
        <Detail label="Service" value={props.payload?.incident.service ?? "not loaded"} />
        <Detail label="Profile" value={props.payload?.profile ?? "not loaded"} />
        <Detail label="Dataset status" value={props.report ? `${props.report.status}; generated ${props.report.generated}` : "not seeded"} />
        <Detail
          label="Dataset clusters"
          value={props.report ? Object.entries(props.report.clusters).map(([name, count]) => `${name}:${count}`).join(", ") : "not seeded"}
        />
      </div>
    </Panel>
  );
}

function Input(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-slate-500">{props.label}</span>
      <input
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="h-10 rounded border border-slate-200 px-3 outline-none focus:border-signal focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  );
}

function D3CausalityGraph(props: {
  graph: CausalityGraphData;
  selectedId: string;
  onSelect: (node: Omit<GraphNode, "x" | "y">) => void;
}) {
  const layout = useMemo(() => {
    type LayoutNode = Omit<GraphNode, "x" | "y"> & d3.SimulationNodeDatum & { x: number; y: number };
    type LayoutLink = Omit<CausalityEdge, "source" | "target"> &
      d3.SimulationLinkDatum<LayoutNode> & {
        source: string | LayoutNode;
        target: string | LayoutNode;
      };
    const nodes = props.graph.nodes.map((node, index) => ({
      ...node,
      x: 120 + (index % 3) * 160,
      y: 90 + Math.floor(index / 3) * 100
    })) satisfies LayoutNode[];
    const links = props.graph.edges.map((edge) => ({ ...edge })) satisfies LayoutLink[];
    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3.forceLink<LayoutNode, LayoutLink>(links)
          .id((node) => node.id)
          .distance(118)
          .strength((edge) => Math.max(0.35, edge.weight))
      )
      .force("charge", d3.forceManyBody().strength(-420))
      .force("center", d3.forceCenter(260, 180))
      .force("collision", d3.forceCollide(46))
      .stop();
    for (let index = 0; index < 160; index += 1) {
      simulation.tick();
    }
    return { nodes, links };
  }, [props.graph]);

  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));

  return (
    <svg viewBox="0 0 520 360" className="min-h-[320px] w-full rounded border border-slate-200 bg-white">
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="#64748b" />
        </marker>
      </defs>
      {layout.links.map((edge) => {
        const source = typeof edge.source === "string" ? nodeById.get(edge.source) : edge.source;
        const target = typeof edge.target === "string" ? nodeById.get(edge.target) : edge.target;
        if (!source || !target) {
          return null;
        }
        return (
          <g key={`${source.id}-${target.id}-${edge.relationship}`}>
            <line
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke="#94a3b8"
              strokeWidth={Math.max(1.5, edge.weight * 3)}
              markerEnd="url(#arrow)"
            />
            <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 6} textAnchor="middle" className="fill-slate-500 text-[10px] font-medium">
              {edge.relationship}
            </text>
          </g>
        );
      })}
      {layout.nodes.map((node) => (
        <GraphNodeView
          key={node.id}
          node={node}
          selected={node.id === props.selectedId}
          onSelect={() => props.onSelect(node)}
        />
      ))}
    </svg>
  );
}

function ReasoningReplayPanel(props: { replay: ReasoningReplay; onReplay: () => void }) {
  const points = useMemo(() => {
    const steps = props.replay.events.map((event) => event.step);
    const x = d3.scalePoint<string>().domain(steps).range([70, 450]).padding(0.4);
    return props.replay.events.map((event, index) => ({
      event,
      x: x(event.step) ?? 70 + index * 95,
      y: 120 + (index % 2) * 70
    }));
  }, [props.replay.events]);

  return (
    <Panel title="AI Reasoning Trace Replay" action={<ActionButton icon={<Play size={16} />} label="Replay" onClick={props.onReplay} />}>
      <div className="grid gap-4 p-4">
        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{props.replay.summary}</div>
        <svg viewBox="0 0 520 250" className="min-h-[230px] w-full rounded border border-slate-200 bg-white">
          {points.slice(1).map((point, index) => {
            const previous = points[index];
            return (
              <line
                key={`${previous.event.eventId}-${point.event.eventId}`}
                x1={previous.x}
                y1={previous.y}
                x2={point.x}
                y2={point.y}
                stroke="#64748b"
                strokeWidth="2"
                strokeDasharray="5 5"
              />
            );
          })}
          {points.map((point, index) => (
            <g key={point.event.eventId}>
              <circle cx={point.x} cy={point.y} r="28" fill={index === points.length - 1 ? "#0f766e" : "#334155"} />
              <text x={point.x} y={point.y + 4} textAnchor="middle" className="fill-white text-[12px] font-semibold">
                {index + 1}
              </text>
              <text x={point.x} y={point.y + 45} textAnchor="middle" className="fill-slate-700 text-[11px] font-medium">
                {point.event.step.replace(/_/g, " ")}
              </text>
            </g>
          ))}
        </svg>
        <div className="grid gap-2">
          {props.replay.events.map((event) => (
            <div key={event.eventId} className="rounded border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono text-xs text-slate-500">{event.eventId}</div>
                <div className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{event.durationMs}ms</div>
              </div>
              <div className="mt-1 text-sm font-semibold">{event.step.replace(/_/g, " ")}</div>
              <p className="mt-1 text-sm leading-6 text-slate-600">{event.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function GraphEdge(props: { x1: number; y1: number; x2: number; y2: number }) {
  return <line {...props} stroke="#94a3b8" strokeWidth="2" strokeDasharray="6 6" />;
}

function GraphNodeView(props: { node: GraphNode; selected: boolean; onSelect: () => void }) {
  const fill = {
    deploy: "#0f766e",
    deployment: "#0f766e",
    metric: "#eab308",
    fault: "#dc2626",
    incident: "#475569",
    service: "#2563eb",
    signal: "#9333ea"
  }[props.node.kind];
  return (
    <g onClick={props.onSelect} className="cursor-pointer">
      <circle cx={props.node.x} cy={props.node.y} r={props.selected ? 40 : 34} fill={fill} opacity={props.selected ? 1 : 0.9} />
      <circle cx={props.node.x} cy={props.node.y} r={props.selected ? 48 : 0} fill="none" stroke="#0f766e" strokeWidth="2" />
      <text x={props.node.x} y={props.node.y + 58} textAnchor="middle" className="fill-slate-700 text-[13px] font-medium">
        {props.node.label}
      </text>
    </g>
  );
}

function mapSyntheticPayloadIncident(payload: SyntheticIncidentPayload): Incident {
  return {
    incidentId: payload.incident.incidentId,
    service: payload.incident.service,
    severity: payload.incident.severity,
    summary: payload.incident.summary,
    deploymentVersion: payload.incident.deploymentVersion,
    timestamp: payload.incident.timestamp,
    logs: payload.incident.logs,
    telemetry: payload.incident.telemetry,
    status: "Investigating"
  };
}

function formatTelemetryInput(values: Record<string, number | string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mapRemoteMemory(memory: RemoteMemory): SearchResult {
  const score = memory.rankScore || memory.score || memory.similarityScore || 0;
  return {
    incidentId: memory.incidentId,
    service: memory.service,
    severity: memory.severity,
    summary: memory.summary,
    deploymentVersion: memory.deploymentVersion ?? "memory",
    timestamp: memory.timestamp,
    logs: [
      memory.rootCause ? `rootCause=${memory.rootCause}` : `${memory.memoryType} memory`,
      ...Object.entries(memory.telemetrySignals ?? {}).map(([key, value]) => `${key}=${value}`)
    ],
    telemetry: memory.telemetrySignals ?? {},
    status: "RCA ready",
    score,
    reason: `Vector ${(memory.similarityScore ?? score).toFixed(2)} | ${memory.memoryType} | ${Object.keys(memory.rankingSignals ?? {}).slice(0, 3).join(", ")}`
  };
}

function normalizeCausalityGraph(graph: CausalityGraphData): CausalityGraphData {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind === "deployment" ? "deployment" : node.kind,
      detail: node.detail,
      score: node.score,
      service: node.service,
      severity: node.severity
    })),
    edges: graph.edges ?? [],
    blastRadius: graph.blastRadius ?? [],
    recurringPatterns: graph.recurringPatterns ?? [],
    reasoningSummary: graph.reasoningSummary ?? "Causality graph ready."
  };
}

function buildSyntheticGraphPreview(payload: SyntheticIncidentPayload): CausalityGraphData {
  return {
    incidentId: payload.incidentId,
    tenantId: payload.tenantId,
    nodes: [
      {
        id: `service:${payload.incident.service}`,
        label: payload.incident.service,
        kind: "service",
        service: payload.incident.service,
        detail: "Synthetic service from /api/v1/synthetic/incidents/next.",
        score: 0.8
      },
      {
        id: `deployment:${payload.incident.service}:${payload.incident.deploymentVersion}`,
        label: `Deploy ${payload.incident.deploymentVersion}`,
        kind: "deployment",
        service: payload.incident.service,
        detail: "Deployment marker supplied by the synthetic causality payload.",
        score: 0.72
      },
      {
        id: `incident:${payload.incidentId}`,
        label: payload.incidentId,
        kind: "incident",
        service: payload.incident.service,
        severity: payload.incident.severity,
        detail: payload.incident.summary,
        score: 1
      }
    ],
    edges: [
      {
        source: `deployment:${payload.incident.service}:${payload.incident.deploymentVersion}`,
        target: `service:${payload.incident.service}`,
        relationship: "CHANGED",
        weight: 0.78,
        evidence: [payload.incident.deploymentVersion]
      },
      {
        source: `service:${payload.incident.service}`,
        target: `incident:${payload.incidentId}`,
        relationship: "EXPERIENCED",
        weight: 1,
        evidence: [payload.incident.summary]
      }
    ],
    blastRadius: [payload.incident.service],
    recurringPatterns: [payload.incident.rootCause.toLowerCase().replace(/[^a-z0-9]+/g, "-")],
    reasoningSummary: `Synthetic graph preview for ${payload.incidentId}. Use Build Graph to call the causality API.`
  };
}

function tokenize(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
}

function scoreIncident(incident: Incident, query: string): SearchResult {
  const queryTokens = tokenize(query);
  const bodyTokens = tokenize(`${incident.service} ${incident.summary} ${incident.deploymentVersion} ${incident.logs.join(" ")}`);
  const matches = queryTokens.filter((token) => bodyTokens.includes(token));
  const score = Math.min(0.98, 0.35 + matches.length * 0.16 + (incident.severity === "CRITICAL" ? 0.08 : 0));
  return {
    ...incident,
    score,
    reason: matches.length ? `Matched ${matches.join(", ")}` : "Related by service and telemetry context"
  };
}

function isGreeting(question: string): boolean {
  const normalized = question.trim().toLowerCase();
  return ["hi", "hello", "hey", "yo", "hola", "oho", "oho\\"].includes(normalized);
}

function asksForSimilarIncidents(question: string): boolean {
  const lower = question.toLowerCase();
  return (
    lower.includes("similar incident") ||
    lower.includes("other incident") ||
    lower.includes("past incident") ||
    lower.includes("related incident") ||
    lower.includes("anything similar")
  );
}

async function fetchSimilarIncidents(
  incident: Incident,
  syntheticPayload: SyntheticIncidentPayload | null
): Promise<SearchResult[]> {
  const syntheticSearch =
    syntheticPayload?.incidentId === incident.incidentId
      ? syntheticPayload.memorySearch
      : null;
  const response = await fetch(apiUrl("/api/v1/memory/search"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(syntheticSearch ?? {
        query: incident.summary,
        tenantId: "synthetic",
        teamId: "dashboard",
        requestedBy: "dashboard",
        role: "platform-admin",
        service: incident.service,
        severity: incident.severity,
        limit: 3,
        telemetry: incident.telemetry,
        memoryTypes: ["episodic", "semantic", "procedural"]
      }),
      query: incident.summary,
      role: "platform-admin",
      limit: 3
    })
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return ((await response.json()) as RemoteMemory[]).map(mapRemoteMemory);
}

function formatSimilarIncidentsAnswer(incident: Incident, similarIncidents: SearchResult[]): string {
  if (!similarIncidents.length) {
    return `No close historical matches were retrieved for ${incident.incidentId} on ${incident.service}. This looks like a currently isolated incident based on the available memory index.`;
  }
  return [
    `Found ${similarIncidents.length} related incidents for ${incident.incidentId} on ${incident.service}:`,
    ...similarIncidents.map((match) => `${match.incidentId}: ${match.summary} (${match.reason})`)
  ].join(" ");
}

function buildRcaQuery(incident: Incident, question: string): string {
  const telemetry = formatTelemetrySnapshot(incident.telemetry);
  const signals = incident.logs.slice(0, 4).join("; ");
  return [
    `Operator question: ${question}`,
    `Incident ID: ${incident.incidentId}`,
    `Service: ${incident.service}`,
    `Severity: ${incident.severity}`,
    `Deployment: ${incident.deploymentVersion}`,
    `Incident summary: ${incident.summary}`,
    `Recent signals: ${signals || "none"}`,
    `Telemetry snapshot: ${telemetry || "none"}`
  ].join("\n");
}

function formatTelemetrySnapshot(telemetry: Record<string, number | string>): string {
  return Object.entries(telemetry)
    .slice(0, 4)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function formatRcaChatAnswer(question: string, incident: Incident, rca: RcaResult): string {
  const lowerQuestion = question.toLowerCase();
  const telemetry = formatTelemetrySnapshot(incident.telemetry);
  const where = `${incident.service} on ${incident.deploymentVersion}`;
  const evidence = rca.evidence.slice(0, 3).join("; ");
  const nextSteps = rca.remediation.slice(0, 3).join("; ");
  const liveSummary = rca.summary || `Current issue: ${incident.summary}`;

  if (lowerQuestion.includes("where") || lowerQuestion.includes("which service") || lowerQuestion.includes("which incident")) {
    return `Incident ${incident.incidentId} is active on ${where}. ${liveSummary} Live telemetry: ${telemetry || "no telemetry snapshot available yet"}.`;
  }
  if (lowerQuestion.includes("fix") || lowerQuestion.includes("resolve") || lowerQuestion.includes("remediation") || lowerQuestion.includes("how")) {
    return `Fix path for ${incident.incidentId} on ${where}: ${nextSteps}. Likely root cause: ${rca.likelyRootCause}.`;
  }
  if (lowerQuestion.includes("evidence")) {
    return `Evidence for ${incident.incidentId}: ${evidence}. Likely root cause: ${rca.likelyRootCause}.`;
  }
  if (lowerQuestion.includes("first") || lowerQuestion.includes("remediation") || lowerQuestion.includes("do")) {
    return `First action for ${incident.incidentId}: ${rca.remediation[0] ?? "Correlate logs, metrics and deployment changes."} Then continue with: ${rca.remediation.slice(1, 3).join("; ")}.`;
  }
  if (lowerQuestion.includes("change") || lowerQuestion.includes("deploy")) {
    return `Most relevant change context for ${incident.incidentId}: ${liveSummary} Check deployment and config drift on ${where} before treating this as organic load growth.`;
  }
  return `${liveSummary} Likely root cause for ${incident.incidentId} on ${where}: ${rca.likelyRootCause}. Live evidence: ${evidence}. Recommended next steps: ${nextSteps}.`;
}

function parseTelemetry(value: string): Record<string, number | string> {
  return value.split(",").reduce<Record<string, number | string>>((acc, pair) => {
    const [rawKey, rawValue] = pair.split("=").map((part) => part.trim());
    if (!rawKey || rawValue === undefined) {
      return acc;
    }
    const numeric = Number(rawValue);
    acc[rawKey] = Number.isFinite(numeric) ? numeric : rawValue;
    return acc;
  }, {});
}

function metricHealth(values: Record<string, number | string>): MetricSample["health"] {
  const numericValues = Object.entries(values).map(([key, value]) => [key, Number(value)] as const);
  const hasCritical = numericValues.some(([key, value]) => {
    if (!Number.isFinite(value)) {
      return false;
    }
    return (
      (key.includes("error") && value >= 10) ||
      (key.includes("latency") && value >= 1500) ||
      (key.includes("memory") && value >= 90) ||
      (key.includes("restart") && value >= 5)
    );
  });
  if (hasCritical) {
    return "Critical";
  }
  const hasWarning = numericValues.some(([key, value]) => {
    if (!Number.isFinite(value)) {
      return false;
    }
    return (
      (key.includes("error") && value >= 5) ||
      (key.includes("latency") && value >= 700) ||
      (key.includes("lag") && value >= 500) ||
      (key.includes("memory") && value >= 75)
    );
  });
  return hasWarning ? "Warning" : "Healthy";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
