import hashlib
import logging

import numpy as np

from config import settings

log = logging.getLogger(__name__)


class EmbeddingModel:
    def __init__(self) -> None:
        self._model = None

    def encode(self, text: str) -> list[float]:
        model = self._load_model()
        if model is None:
            return self._stable_fallback_embedding(text)
        vector = model.encode(text, normalize_embeddings=True)
        return vector.astype(float).tolist()

    def _load_model(self):
        if self._model is not None:
            return self._model
        try:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(settings.embedding_model)
            return self._model
        except Exception as exc:  # pragma: no cover - defensive startup fallback
            log.warning("embedding_model_unavailable fallback=hash reason=%s", exc)
            self._model = False
            return None

    def _stable_fallback_embedding(self, text: str) -> list[float]:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        seed = int.from_bytes(digest[:8], "big")
        rng = np.random.default_rng(seed)
        vector = rng.normal(size=settings.embedding_dimension)
        norm = np.linalg.norm(vector)
        if norm == 0:
            return vector.astype(float).tolist()
        return (vector / norm).astype(float).tolist()
