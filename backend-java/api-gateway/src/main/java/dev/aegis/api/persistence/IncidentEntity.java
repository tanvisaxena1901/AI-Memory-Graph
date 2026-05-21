package dev.aegis.api.persistence;

import dev.aegis.common.model.IncidentSeverity;
import java.time.Instant;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;

@Table("incidents")
public class IncidentEntity {
    @Id
    private String incidentId;
    private String tenantId;
    private String teamId;
    private String serviceOwner;
    private String service;
    private IncidentSeverity severity;
    private String summary;
    private String deploymentVersion;
    private Instant timestamp;
    private String rootCause;
    private String remediation;
    private Boolean successfulRemediation;
    private Double aiConfidence;
    private Boolean humanConfirmed;
    private String runbookRef;

    public String getIncidentId() {
        return incidentId;
    }

    public void setIncidentId(String incidentId) {
        this.incidentId = incidentId;
    }

    public String getTenantId() {
        return tenantId;
    }

    public void setTenantId(String tenantId) {
        this.tenantId = tenantId;
    }

    public String getTeamId() {
        return teamId;
    }

    public void setTeamId(String teamId) {
        this.teamId = teamId;
    }

    public String getServiceOwner() {
        return serviceOwner;
    }

    public void setServiceOwner(String serviceOwner) {
        this.serviceOwner = serviceOwner;
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

    public String getRootCause() {
        return rootCause;
    }

    public void setRootCause(String rootCause) {
        this.rootCause = rootCause;
    }

    public String getRemediation() {
        return remediation;
    }

    public void setRemediation(String remediation) {
        this.remediation = remediation;
    }

    public Boolean getSuccessfulRemediation() {
        return successfulRemediation;
    }

    public void setSuccessfulRemediation(Boolean successfulRemediation) {
        this.successfulRemediation = successfulRemediation;
    }

    public Double getAiConfidence() {
        return aiConfidence;
    }

    public void setAiConfidence(Double aiConfidence) {
        this.aiConfidence = aiConfidence;
    }

    public Boolean getHumanConfirmed() {
        return humanConfirmed;
    }

    public void setHumanConfirmed(Boolean humanConfirmed) {
        this.humanConfirmed = humanConfirmed;
    }

    public String getRunbookRef() {
        return runbookRef;
    }

    public void setRunbookRef(String runbookRef) {
        this.runbookRef = runbookRef;
    }
}
