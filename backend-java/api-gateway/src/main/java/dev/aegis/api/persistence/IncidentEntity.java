package dev.aegis.api.persistence;

import dev.aegis.common.model.IncidentSeverity;
import java.time.Instant;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;

@Table("incidents")
public class IncidentEntity {
    @Id
    private String incidentId;
    private String service;
    private IncidentSeverity severity;
    private String summary;
    private String deploymentVersion;
    private Instant timestamp;

    public String getIncidentId() {
        return incidentId;
    }

    public void setIncidentId(String incidentId) {
        this.incidentId = incidentId;
    }

    public String getService() {
        return service;
    }

    public void setService(String service) {
        this.service = service;
    }

    public IncidentSeverity getSeverity() {
        return severity;
    }

    public void setSeverity(IncidentSeverity severity) {
        this.severity = severity;
    }

    public String getSummary() {
        return summary;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }

    public String getDeploymentVersion() {
        return deploymentVersion;
    }

    public void setDeploymentVersion(String deploymentVersion) {
        this.deploymentVersion = deploymentVersion;
    }

    public Instant getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(Instant timestamp) {
        this.timestamp = timestamp;
    }
}
