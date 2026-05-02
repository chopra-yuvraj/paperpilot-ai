import os
import uuid
import logging
from typing import List, Dict, Optional

from pinecone import Pinecone, ServerlessSpec
from langchain_google_genai import GoogleGenerativeAIEmbeddings

logger = logging.getLogger(__name__)

# Maximum metadata size for Pinecone (40KB limit, keep well under)
MAX_CONTENT_METADATA_CHARS = 3500
BATCH_SIZE = 100


class EmbeddingEngine:
    """Handles text embedding and vector storage/retrieval via Pinecone."""

    def __init__(self, model_name: str = "models/text-embedding-004"):
        logger.info(f"Initializing EmbeddingEngine with model: {model_name}")
        self.model_name = model_name
        self.dimension = 768

        # --- Google Gemini Embeddings ---
        self.api_key = os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError(
                "GEMINI_API_KEY not found in environment. Cannot initialize embeddings."
            )

        self.encoder = GoogleGenerativeAIEmbeddings(
            model=model_name,
            google_api_key=self.api_key,
        )

        # --- Pinecone Vector DB ---
        self.pinecone_api_key = os.getenv("PINECONE_API_KEY")
        self.index_name = os.getenv("PINECONE_INDEX", "paperpilot-index")
        self.pc: Optional[Pinecone] = None
        self.index = None

        if not self.pinecone_api_key:
            raise ValueError(
                "PINECONE_API_KEY not found in environment. Cannot initialize vector store."
            )

        try:
            self.pc = Pinecone(api_key=self.pinecone_api_key)
            self.index = self.pc.Index(self.index_name)
            logger.info(f"Connected to Pinecone index: {self.index_name}")
        except Exception as e:
            logger.error(f"Pinecone initialization failed: {e}")
            raise

    def ensure_index_exists(self) -> None:
        """Create the Pinecone index if it doesn't already exist."""
        if not self.pc:
            logger.warning("Pinecone client not initialized. Skipping index check.")
            return

        try:
            existing = [idx.name for idx in self.pc.list_indexes()]
            if self.index_name not in existing:
                logger.info(f"Creating Pinecone index: {self.index_name}")
                self.pc.create_index(
                    name=self.index_name,
                    dimension=self.dimension,
                    metric="cosine",
                    spec=ServerlessSpec(
                        cloud="aws",
                        region=os.getenv("PINECONE_ENV", "us-east-1"),
                    ),
                )
                # Re-connect to the newly created index
                self.index = self.pc.Index(self.index_name)
                logger.info(f"Index '{self.index_name}' created successfully.")
            else:
                logger.info(f"Index '{self.index_name}' already exists.")
        except Exception as e:
            logger.error(f"Index existence check failed: {e}")

    def _get_embedding(self, text: str) -> List[float]:
        """Generate an embedding vector for the given text."""
        return self.encoder.embed_query(text)

    def ingest_sections(
        self, sections: List[Dict[str, str]], filename: str = "unknown"
    ) -> int:
        """
        Embed and upsert paper sections into Pinecone.

        Args:
            sections: List of dicts with 'title' and 'content' keys.
            filename: Original filename for metadata tracking.

        Returns:
            Number of vectors upserted.
        """
        if not sections:
            logger.warning("No sections provided for ingestion.")
            return 0

        if not self.index:
            logger.error("Pinecone index not available. Cannot ingest.")
            return 0

        logger.info(f"Processing {len(sections)} sections for '{filename}'...")

        vectors = []
        for sec in sections:
            title = sec.get("title", "Untitled")
            content = sec.get("content", "")
            text_for_embedding = f"{title}: {content}"

            try:
                vector = self._get_embedding(text_for_embedding)
            except Exception as e:
                logger.error(f"Embedding failed for section '{title}': {e}")
                continue

            metadata = {
                "title": title,
                "content": content[:MAX_CONTENT_METADATA_CHARS],
                "filename": filename,
            }

            vectors.append(
                {
                    "id": str(uuid.uuid4()),
                    "values": vector,
                    "metadata": metadata,
                }
            )

        # Batch upsert
        upserted = 0
        for i in range(0, len(vectors), BATCH_SIZE):
            batch = vectors[i : i + BATCH_SIZE]
            try:
                self.index.upsert(vectors=batch)
                upserted += len(batch)
            except Exception as e:
                logger.error(f"Upsert batch failed at offset {i}: {e}")

        logger.info(f"Upserted {upserted}/{len(vectors)} vectors to Pinecone.")
        return upserted

    def search(self, query: str, k: int = 5) -> List[Dict]:
        """
        Semantic search across ingested vectors.

        Args:
            query: Natural language query string.
            k: Number of top results to return.

        Returns:
            List of metadata dicts from matching vectors.
        """
        if not self.index:
            logger.error("Pinecone index not available. Cannot search.")
            return []

        try:
            query_vec = self._get_embedding(query)
            results = self.index.query(
                vector=query_vec,
                top_k=k,
                include_metadata=True,
            )

            matches = []
            for match in results.get("matches", []):
                meta = match.get("metadata", {})
                meta["score"] = match.get("score", 0.0)
                matches.append(meta)

            return matches

        except Exception as e:
            logger.error(f"Search failed: {e}")
            return []
