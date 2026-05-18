import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Bot,
  CheckCircle2,
  ChevronRight,
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
  TerminalSquare,
  UserRound
} from "lucide-react";
import "./styles.css";

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type View = "metrics" | "incidents" | "memory" | "graph" | "workflows";

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
};

type ChatMessage = {
  id: string;
  role: "operator" | "aegis";
  content: string;
  timestamp: string;
};

type SearchResult = Incident & { score: number; reason: string };

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
  kind: "deploy" | "metric" | "fault" | "incident" | "service";
  x: number;
  y: number;
  detail: string;
};

const initialIncidents: Incident[] = [
  {
    incidentId: "INC-1001",
    service: "payment-service",
    severity: "HIGH",
    summary: "Redis connection saturation after v2.3 deployment",
    deploymentVersion: "v2.3",
    timestamp: "2026-05-18T08:24:00.000Z",
    logs: ["redis timeout after 500ms", "connection pool exhausted", "payment retries increased"],
    telemetry: { redis_latency_ms: 820, error_rate: "18%", consumer_lag: 1480 },
    status: "Investigating"
  },
  {
    incidentId: "INC-1002",
    service: "checkout-api",
    severity: "MEDIUM",
    summary: "API timeout chain from consumer lag",
    deploymentVersion: "v4.8",
    timestamp: "2026-05-18T07:52:00.000Z",
    logs: ["p95 latency crossed 2200ms", "orders topic lag rising"],
    telemetry: { p95_latency_ms: 2260, error_rate: "7%", lag: 3900 },
    status: "RCA ready"
  },
  {
    incidentId: "INC-1003",
    service: "inventory-worker",
    severity: "CRITICAL",
    summary: "CrashLoopBackOff after memory spike during sync job",
    deploymentVersion: "v1.14",
    timestamp: "2026-05-18T06:30:00.000Z",
    logs: ["OOMKilled exit code 137", "heap allocation increased after sync start"],
    telemetry: { restart_count: 9, memory_percent: "96%", queue_depth: 720 },
    status: "Investigating"
  }
];

const graphNodes: GraphNode[] = [
  {
    id: "deploy",
    label: "Deploy v2.3",
    kind: "deploy",
    x: 92,
    y: 82,
    detail: "payment-service rollout started 18 minutes before the Redis incident."
  },
  {
    id: "service",
    label: "payment-service",
    kind: "service",
    x: 250,
    y: 82,
    detail: "High retry pressure and elevated latency on checkout dependency calls."
  },
  {
    id: "metric",
    label: "Redis latency",
    kind: "metric",
    x: 250,
    y: 214,
    detail: "Latency crossed 820ms with connection pool saturation."
  },
  {
    id: "fault",
    label: "API timeout",
    kind: "fault",
    x: 415,
    y: 150,
    detail: "Timeouts propagated to checkout and order confirmation APIs."
  },
  {
    id: "incident",
    label: "INC-1001",
    kind: "incident",
    x: 415,
    y: 282,
    detail: "Current investigation combines telemetry, memory matches, and deployment context."
  }
];

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
  const [selectedId, setSelectedId] = useState(initialIncidents[0].incidentId);
  const [query, setQuery] = useState("Redis latency after deployment");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [rca, setRca] = useState<RcaResult>(() => buildLocalRca(initialIncidents[0], []));
  const [status, setStatus] = useState("Dashboard running in local memory mode");
  const [selectedGraphNode, setSelectedGraphNode] = useState(graphNodes[0]);
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
      { label: "Graph edges", value: "9", icon: <GitBranch size={18} />, tone: "amber" }
    ],
    [incidents, metricSamples.length, services.length]
  );

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
    setRca(buildLocalRca(incident, searchResults));
    setStatus(`${incident.incidentId} selected for investigation`);
  }

  function runSearch() {
    const ranked = incidents
      .map((incident) => scoreIncident(incident, query))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score);
    const finalResults = ranked.length > 0 ? ranked : incidents.map((incident) => ({ ...incident, score: 0.42, reason: "fallback memory candidate" }));
    setSearchResults(finalResults);
    setActiveView("memory");
    setStatus(`Semantic search returned ${finalResults.length} memory matches`);
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
      const response = await fetch("/telemetry-api/v1/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sample)
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      setStatus(`${sample.id} collected through telemetry service`);
    } catch {
      setStatus(`${sample.id} collected locally because telemetry service is unavailable`);
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
    setRca(buildLocalRca(created, searchResults));
    setStatus(`${created.incidentId} opened from ${sample.id}`);
    setActiveView("incidents");
  }

  async function generateRca() {
    try {
      const response = await fetch("/api/v1/rca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incidentId: selectedIncident.incidentId,
          query: selectedIncident.summary,
          logs: selectedIncident.logs,
          telemetry: selectedIncident.telemetry
        })
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const remote = (await response.json()) as RcaResult;
      setRca(remote);
      setStatus(`RCA generated by AI engine for ${selectedIncident.incidentId}`);
    } catch {
      setRca(buildLocalRca(selectedIncident, searchResults));
      setStatus(`Local RCA generated for ${selectedIncident.incidentId}`);
    }
    setIncidents((current) =>
      current.map((incident) =>
        incident.incidentId === selectedIncident.incidentId ? { ...incident, status: "RCA ready" } : incident
      )
    );
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
      const response = await fetch("/api/v1/rca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incidentId: selectedIncident.incidentId,
          query: `${question}\nIncident: ${selectedIncident.summary}`,
          logs: selectedIncident.logs,
          telemetry: selectedIncident.telemetry
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
          content: formatRcaChatAnswer(question, remote),
          timestamp: new Date().toISOString()
        }
      ]);
      setStatus(`RCA chat answered by AI engine for ${selectedIncident.incidentId}`);
    } catch {
      const local = buildLocalRca(selectedIncident, searchResults);
      setRca(local);
      setChatMessages((current) => [
        ...current,
        {
          id: `aegis-${Date.now()}`,
          role: "aegis",
          content: buildLocalChatAnswer(question, selectedIncident, local),
          timestamp: new Date().toISOString()
        }
      ]);
      setStatus(`RCA chat answered locally for ${selectedIncident.incidentId}`);
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
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-5">
          {activeView === "metrics" && (
            <MetricCollectorPanel
              collector={collector}
              metricSamples={metricSamples}
              setCollector={setCollector}
              onCollect={collectMetricSample}
              onOpenIncident={openIncidentFromMetrics}
            />
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
            <Panel title="Operational Memory Graph" action={<ActionButton icon={<GitBranch size={16} />} label="Focus Incident" onClick={() => setSelectedGraphNode(graphNodes[4])} />}>
              <div className="grid gap-4 p-4 lg:grid-cols-[1fr_240px]">
                <svg viewBox="0 0 520 360" className="min-h-[320px] w-full rounded border border-slate-200 bg-white">
                  <GraphEdge x1={92} y1={82} x2={250} y2={82} />
                  <GraphEdge x1={250} y1={82} x2={250} y2={214} />
                  <GraphEdge x1={250} y1={214} x2={415} y2={150} />
                  <GraphEdge x1={250} y1={214} x2={415} y2={282} />
                  {graphNodes.map((node) => (
                    <GraphNodeView
                      key={node.id}
                      node={node}
                      selected={node.id === selectedGraphNode.id}
                      onSelect={() => setSelectedGraphNode(node)}
                    />
                  ))}
                </svg>
                <div className="rounded border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{selectedGraphNode.kind}</div>
                  <div className="mt-2 text-lg font-semibold">{selectedGraphNode.label}</div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{selectedGraphNode.detail}</p>
                  <button
                    onClick={generateRca}
                    className="mt-4 inline-flex h-10 items-center gap-2 rounded bg-graphite px-3 text-sm font-medium text-white transition hover:bg-slate-700"
                  >
                    <Sparkles size={16} />
                    Generate RCA
                  </button>
                </div>
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
                <ActionButton icon={<CheckCircle2 size={16} />} label="Acknowledge" onClick={acknowledgeIncident} />
                <ActionButton icon={<Play size={16} />} label="Workflow" onClick={startWorkflow} />
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

          <Panel title="RCA Output" action={<StatusPill label={selectedIncident.status} compact />}>
            <div className="space-y-4 p-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Likely root cause</div>
                <p className="mt-2 text-sm leading-6 text-slate-700">{rca.likelyRootCause}</p>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence</div>
                <div className="mt-2 space-y-2">
                  {rca.evidence.map((item) => (
                    <div key={item} className="rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">{item}</div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Remediation</div>
                <div className="mt-2 space-y-2">
                  {rca.remediation.map((item) => (
                    <div key={item} className="flex gap-2 rounded border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                      <ChevronRight size={16} className="mt-0.5 shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Live Telemetry" action={<StatusPill label="Streaming" compact />}>
            <div className="space-y-2 p-4">
              {selectedIncident.logs.map((log, index) => (
                <div key={`${log}-${index}`} className="flex items-start gap-2 rounded bg-graphite px-3 py-2 font-mono text-xs text-slate-100">
                  <TerminalSquare size={14} className="mt-0.5 shrink-0 text-emerald-300" />
                  <span>{log}</span>
                </div>
              ))}
            </div>
          </Panel>
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

function GraphEdge(props: { x1: number; y1: number; x2: number; y2: number }) {
  return <line {...props} stroke="#94a3b8" strokeWidth="2" strokeDasharray="6 6" />;
}

function GraphNodeView(props: { node: GraphNode; selected: boolean; onSelect: () => void }) {
  const fill = {
    deploy: "#0f766e",
    metric: "#eab308",
    fault: "#dc2626",
    incident: "#475569",
    service: "#2563eb"
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

function buildLocalRca(incident: Incident, matches: SearchResult[]): RcaResult {
  const text = `${incident.summary} ${incident.logs.join(" ")}`.toLowerCase();
  let likelyRootCause = "Recent runtime behavior changed for the affected service.";
  let remediation = [
    "Compare deployment configuration against the previous stable release.",
    "Correlate logs, metrics and deployment events over the incident window.",
    "Watch downstream timeout and retry pressure before closing the incident."
  ];

  if (text.includes("redis") || text.includes("connection")) {
    likelyRootCause = "Connection pool saturation and backing store latency after deployment.";
    remediation = [
      "Inspect connection pool limits and Redis server latency.",
      "Reduce retry pressure while the service stabilizes.",
      "Rollback the deployment if timeout rate keeps increasing."
    ];
  }

  if (text.includes("oom") || text.includes("memory") || text.includes("crashloop")) {
    likelyRootCause = "Container memory pressure is causing repeated worker restarts.";
    remediation = [
      "Check heap sizing, pod limits and recent allocation changes.",
      "Capture memory profile data before increasing limits permanently.",
      "Pause or throttle the sync workload until restart rate drops."
    ];
  }

  return {
    summary: `AEGIS analyzed ${incident.service} telemetry with ${matches.length} retrieved memory candidates.`,
    likelyRootCause,
    evidence: [
      ...incident.logs.slice(0, 3),
      ...Object.entries(incident.telemetry).slice(0, 3).map(([key, value]) => `${key}=${value}`),
      ...matches.slice(0, 2).map((match) => `similar ${match.incidentId}: ${match.summary}`)
    ],
    remediation
  };
}

function formatRcaChatAnswer(question: string, rca: RcaResult): string {
  const lowerQuestion = question.toLowerCase();
  if (lowerQuestion.includes("evidence")) {
    return `Evidence: ${rca.evidence.slice(0, 3).join("; ")}. Root cause: ${rca.likelyRootCause}`;
  }
  if (lowerQuestion.includes("first") || lowerQuestion.includes("remediation") || lowerQuestion.includes("do")) {
    return `First action: ${rca.remediation[0] ?? "Correlate logs, metrics and deployment changes."} Then validate: ${rca.remediation.slice(1, 3).join("; ")}`;
  }
  if (lowerQuestion.includes("change") || lowerQuestion.includes("deploy")) {
    return `Most relevant change signal: ${rca.summary} Check deployment/config drift before treating this as organic load growth.`;
  }
  return `Likely RCA: ${rca.likelyRootCause} Evidence: ${rca.evidence.slice(0, 2).join("; ")}. Recommended next step: ${rca.remediation[0]}`;
}

function buildLocalChatAnswer(question: string, incident: Incident, rca: RcaResult): string {
  const lowerQuestion = question.toLowerCase();
  const telemetry = Object.entries(incident.telemetry)
    .slice(0, 3)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  if (lowerQuestion.includes("blast") || lowerQuestion.includes("impact")) {
    return `Impact is centered on ${incident.service}. Current telemetry (${telemetry}) suggests downstream calls and retries should be watched before declaring recovery.`;
  }
  if (lowerQuestion.includes("evidence")) {
    return `The strongest evidence is ${rca.evidence.slice(0, 3).join("; ")}. This points to: ${rca.likelyRootCause}`;
  }
  if (lowerQuestion.includes("first") || lowerQuestion.includes("next") || lowerQuestion.includes("do")) {
    return `Start with: ${rca.remediation[0]} Then continue with: ${rca.remediation.slice(1).join("; ")}`;
  }
  if (lowerQuestion.includes("change") || lowerQuestion.includes("deploy")) {
    return `${incident.deploymentVersion} is the active deployment marker for this investigation. Compare it against the previous stable version and correlate the metric jump with rollout time.`;
  }
  return `For ${incident.incidentId}, the most likely root cause is: ${rca.likelyRootCause} Key telemetry: ${telemetry}.`;
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
