import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";

const apiBaseUrl = (__ENV.API_BASE_URL || "http://localhost:8080").replace(/\/+$/, "");
const telemetryBaseUrl = (__ENV.TELEMETRY_API_BASE_URL || "http://localhost:8081").replace(/\/+$/, "");
const tenantId = __ENV.TENANT_ID || "synthetic";
const profile = __ENV.SYNTHETIC_PROFILE || "incident-management";
const incidentRate = Number(__ENV.INCIDENT_RATE || "0.35");

export const options = {
  scenarios: {
    steady_incident_stream: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || "3"),
      duration: __ENV.DURATION || "5m"
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.10"],
    synthetic_payloads_fetched: ["count>=1"],
    synthetic_incidents_opened: ["count>=1"]
  }
};

const payloadsFetched = new Counter("synthetic_payloads_fetched");
const incidentsOpened = new Counter("synthetic_incidents_opened");
const rcaReady = new Rate("synthetic_rca_ready");
const graphReady = new Rate("synthetic_graph_ready");

export function setup() {
  waitForService(`${apiBaseUrl}/actuator/health`, "api gateway");
  waitForService(`${telemetryBaseUrl}/api/v1/telemetry/stats`, "telemetry service");
  waitForService(`${apiBaseUrl}/api/v1/synthetic/incidents/next?tenantId=${tenantId}&profile=${profile}`, "synthetic incident api");
}

export default function () {
  const payload = fetchSyntheticPayload();
  postJson(`${telemetryBaseUrl}/api/v1/telemetry`, payload.telemetryEvent, "telemetry accepted", [200, 202]);

  if (Math.random() < incidentRate) {
    const incidentAccepted = postJson(`${apiBaseUrl}/api/v1/incidents`, payload.incident, "incident accepted", [200, 202]);
    if (incidentAccepted) {
      incidentsOpened.add(1);
      postRca(payload.rca);
      postJson(`${apiBaseUrl}/api/v1/memory/search`, payload.memorySearch, "memory search completed", [200]);
      postCausalityGraph(payload.causality);
    }
  }

  sleep(Number(__ENV.SLEEP_SECONDS || "1"));
}

function fetchSyntheticPayload() {
  const response = http.get(`${apiBaseUrl}/api/v1/synthetic/incidents/next?tenantId=${tenantId}&profile=${profile}`);
  check(response, {
    "synthetic payload fetched": (res) => res.status === 200
  });
  if (response.status !== 200) {
    throw new Error(`synthetic payload fetch failed with HTTP ${response.status}`);
  }
  payloadsFetched.add(1);
  return response.json();
}

function postRca(payload) {
  const response = http.post(`${apiBaseUrl}/api/v1/rca`, JSON.stringify(payload), jsonParams());
  rcaReady.add(response.status >= 200 && response.status < 300);
}

function postCausalityGraph(payload) {
  const response = http.post(`${apiBaseUrl}/api/v1/graph/causality`, JSON.stringify(payload), jsonParams());
  graphReady.add(response.status >= 200 && response.status < 300);
}

function postJson(url, payload, label, allowedStatuses) {
  const response = http.post(url, JSON.stringify(payload), jsonParams());
  return check(response, {
    [label]: (res) => allowedStatuses.includes(res.status)
  });
}

function waitForService(url, label) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const response = http.get(url);
    if (response.status >= 200 && response.status < 300) {
      return;
    }
    sleep(2);
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

function jsonParams() {
  return {
    headers: {
      "Content-Type": "application/json"
    }
  };
}
