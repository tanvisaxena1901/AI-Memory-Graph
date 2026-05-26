package dev.aegis.api.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SyntheticIncidentServiceTest {

    @Test
    void nextIncidentBuildsWorkflowPayloadsFromApiGenerator() {
        SyntheticIncidentService service = new SyntheticIncidentService();

        SyntheticIncidentService.SyntheticIncidentPayload payload = service.nextIncident("tenant-a", "load-test");

        assertThat(payload.incidentId()).startsWith("SYN-");
        assertThat(payload.tenantId()).isEqualTo("tenant-a");
        assertThat(payload.profile()).isEqualTo("load-test");
        assertThat(payload.incident().incidentId()).isEqualTo(payload.incidentId());
        assertThat(payload.telemetryEvent()).containsKeys("service", "source", "values");
        assertThat(payload.rca().telemetry()).isNotEmpty();
        assertThat(payload.memorySearch().memoryTypes()).contains("episodic", "semantic", "procedural");
        assertThat(payload.causality().incidentId()).isEqualTo(payload.incidentId());
    }
}
