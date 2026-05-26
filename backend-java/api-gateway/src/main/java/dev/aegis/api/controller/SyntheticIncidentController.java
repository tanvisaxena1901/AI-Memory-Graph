package dev.aegis.api.controller;

import dev.aegis.api.service.SyntheticIncidentService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/synthetic")
public class SyntheticIncidentController {
    private final SyntheticIncidentService syntheticIncidentService;

    public SyntheticIncidentController(SyntheticIncidentService syntheticIncidentService) {
        this.syntheticIncidentService = syntheticIncidentService;
    }

    @GetMapping("/incidents/next")
    SyntheticIncidentService.SyntheticIncidentPayload nextIncident(
            @RequestParam(defaultValue = "synthetic") String tenantId,
            @RequestParam(defaultValue = "incident-management") String profile
    ) {
        return syntheticIncidentService.nextIncident(tenantId, profile);
    }
}
