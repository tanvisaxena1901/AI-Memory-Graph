package dev.aegis.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "aegis.ai-engine")
public record AiEngineProperties(String baseUrl) {
}
