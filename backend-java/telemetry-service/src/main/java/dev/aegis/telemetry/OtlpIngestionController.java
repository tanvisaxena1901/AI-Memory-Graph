package dev.aegis.telemetry;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OtlpIngestionController {
    private static final Logger log = LoggerFactory.getLogger(OtlpIngestionController.class);

    private final TelemetryBuffer telemetryBuffer;

    public OtlpIngestionController(TelemetryBuffer telemetryBuffer) {
        this.telemetryBuffer = telemetryBuffer;
    }

    @PostMapping(path = "/v1/metrics", consumes = MediaType.ALL_VALUE)
    @ResponseStatus(HttpStatus.OK)
    void ingestMetrics(
            @RequestBody byte[] payload,
            @RequestHeader(value = HttpHeaders.CONTENT_TYPE, required = false) String contentType
    ) {
        record("metrics", payload, contentType);
    }

    @PostMapping(path = "/v1/logs", consumes = MediaType.ALL_VALUE)
    @ResponseStatus(HttpStatus.OK)
    void ingestLogs(
            @RequestBody byte[] payload,
            @RequestHeader(value = HttpHeaders.CONTENT_TYPE, required = false) String contentType
    ) {
        record("logs", payload, contentType);
    }

    @PostMapping(path = "/v1/traces", consumes = MediaType.ALL_VALUE)
    @ResponseStatus(HttpStatus.OK)
    void ingestTraces(
            @RequestBody byte[] payload,
            @RequestHeader(value = HttpHeaders.CONTENT_TYPE, required = false) String contentType
    ) {
        record("traces", payload, contentType);
    }

    private void record(String signal, byte[] payload, String contentType) {
        TelemetryBuffer.TelemetryEnvelope envelope =
                telemetryBuffer.recordOtlp(signal, payload == null ? 0 : payload.length, contentType);
        log.info("otlp_batch_received signal={} bytes={} contentType={}",
                signal, envelope.byteSize(), contentType);
    }
}
