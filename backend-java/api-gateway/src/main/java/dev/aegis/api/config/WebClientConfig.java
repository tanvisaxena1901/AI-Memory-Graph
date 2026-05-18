package dev.aegis.api.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.function.client.WebClient;

@Configuration
public class WebClientConfig {
    @Bean
    WebClient aiEngineWebClient(WebClient.Builder builder, AiEngineProperties properties) {
        return builder.baseUrl(properties.baseUrl()).build();
    }
}
