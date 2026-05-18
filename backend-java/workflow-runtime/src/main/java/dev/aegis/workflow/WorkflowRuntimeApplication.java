package dev.aegis.workflow;

import java.time.Instant;
import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
public class WorkflowRuntimeApplication {
    public static void main(String[] args) {
        SpringApplication.run(WorkflowRuntimeApplication.class, args);
    }
}

@RestController
@RequestMapping("/api/v1/workflows")
class WorkflowController {
    @PostMapping("/incident-investigation")
    @ResponseStatus(HttpStatus.ACCEPTED)
    WorkflowRun startIncidentInvestigation(@RequestBody Map<String, Object> payload) {
        return new WorkflowRun("queued", "wf-" + System.currentTimeMillis(), Instant.now(), payload);
    }

    record WorkflowRun(String status, String workflowId, Instant queuedAt, Map<String, Object> input) {
    }
}
