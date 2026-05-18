from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="AEGIS_")

    app_name: str = "aegis-ai-engine"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dimension: int = 384

    opensearch_url: str = "http://localhost:9200"
    opensearch_user: str | None = None
    opensearch_password: str | None = None
    opensearch_index: str = "aegis-incidents"

    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "aegis-password"

    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.1"
    use_ollama: bool = False


settings = Settings()
