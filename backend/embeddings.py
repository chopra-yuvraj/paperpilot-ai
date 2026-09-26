"""
Lightweight in-session vector store for PaperPilot AI.

Replaces the previous Pinecone + hosted-embeddings stack with a pure-Python
TF-IDF retriever. This removes all external vector-DB credentials, works on
serverless platforms (no cold-start network deps), and is fast enough for
single-paper retrieval. LLM generation is handled separately via Groq.
"""
import math
import re
import logging
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150

STOPWORDS = frozenset(
    "a an the and or but if then else when at by for with about into through "
    "during before after above below to from up down in out on off over under "
    "again further once here there all any both each few more most other some "
    "such no nor not only own same so than too very can will just should now "
    "is are was were be been being have has had having do does did doing would "
    "could ought i you he she it we they this that these those am of as its "
    "their his her our your my me him them us what which who whom".split()
)

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> List[str]:
    return [t for t in _TOKEN_RE.findall(text.lower()) if t not in STOPWORDS]


def _chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """Split text into overlapping chunks, preferring paragraph boundaries."""
    text = text.strip()
    if len(text) <= size:
        return [text] if text else []

    chunks = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            # Prefer breaking at a paragraph, newline, or sentence end
            boundary = max(
                text.rfind("\n\n", start, end),
                text.rfind("\n", start, end),
                text.rfind(". ", start, end),
            )
            if boundary > start + size // 2:
                end = boundary + 1
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return chunks


class _TfidfIndex:
    """Minimal TF-IDF index over text chunks with cosine similarity search."""

    def __init__(self, docs: List[Dict[str, str]]):
        self.docs = docs
        doc_tokens = [_tokenize(d["content"]) for d in docs]

        # Document frequency
        df: Dict[str, int] = {}
        for tokens in doc_tokens:
            for term in set(tokens):
                df[term] = df.get(term, 0) + 1

        n_docs = max(len(docs), 1)
        self.idf = {
            term: math.log((1 + n_docs) / (1 + count)) + 1.0
            for term, count in df.items()
        }

        # Normalized TF-IDF vector per doc: term -> weight
        self.vectors: List[Dict[str, float]] = []
        for tokens in doc_tokens:
            if not tokens:
                self.vectors.append({})
                continue
            tf: Dict[str, int] = {}
            for t in tokens:
                tf[t] = tf.get(t, 0) + 1
            vec = {
                term: (count / len(tokens)) * self.idf[term]
                for term, count in tf.items()
            }
            norm = math.sqrt(sum(w * w for w in vec.values())) or 1.0
            self.vectors.append({t: w / norm for t, w in vec.items()})

    def _query_vector(self, query: str) -> Dict[str, float]:
        tokens = _tokenize(query)
        if not tokens:
            return {}
        tf: Dict[str, int] = {}
        for t in tokens:
            tf[t] = tf.get(t, 0) + 1
        vec = {
            term: (count / len(tokens)) * self.idf.get(term, 0.0)
            for term, count in tf.items()
            if term in self.idf
        }
        norm = math.sqrt(sum(w * w for w in vec.values())) or 1.0
        return {t: w / norm for t, w in vec.items()}

    def search(self, query: str, k: int = 5) -> List[Dict]:
        qvec = self._query_vector(query)
        if not qvec:
            return []

        scored = []
        for i, dvec in enumerate(self.vectors):
            # Both vectors are L2-normalized, dot product = cosine similarity
            score = sum(w * dvec.get(t, 0.0) for t, w in qvec.items())
            if score > 0:
                result = dict(self.docs[i])
                result["score"] = score
                scored.append(result)

        scored.sort(key=lambda d: d["score"], reverse=True)
        return scored[:k]


class EmbeddingEngine:
    """
    Session-scoped text retriever.

    Keeps the same public interface the rest of the app expects
    (``ensure_index_exists`` / ``ingest_sections`` / ``search``) and adds a
    stateless ``search_sections`` helper for serverless deployments where
    in-memory state cannot be relied upon.
    """

    def __init__(self):
        self._docs: List[Dict[str, str]] = []
        self._index: Optional[_TfidfIndex] = None
        logger.info("EmbeddingEngine (TF-IDF session store) initialized.")

    def ensure_index_exists(self) -> None:
        """No external index to create — kept for interface compatibility."""
        return None

    def _sections_to_docs(
        self, sections: List[Dict[str, str]], filename: str
    ) -> List[Dict[str, str]]:
        docs = []
        for sec in sections:
            title = sec.get("title", "Untitled")
            content = sec.get("content", "")
            for chunk in _chunk_text(f"{title}\n{content}"):
                docs.append({"title": title, "content": chunk, "filename": filename})
        return docs

    def ingest_sections(
        self, sections: List[Dict[str, str]], filename: str = "unknown"
    ) -> int:
        """Index paper sections into the session store."""
        if not sections:
            logger.warning("No sections provided for ingestion.")
            return 0

        self._docs = self._sections_to_docs(sections, filename)
        self._index = _TfidfIndex(self._docs) if self._docs else None
        logger.info(f"Indexed {len(self._docs)} chunks from '{filename}'.")
        return len(self._docs)

    def search(self, query: str, k: int = 5) -> List[Dict]:
        """Search the sections most recently ingested in this process."""
        if not self._index:
            logger.warning("No ingested sections available for search.")
            return []
        return self._index.search(query, k=k)

    @staticmethod
    def search_sections(
        query: str, sections: List[Dict[str, str]], k: int = 5
    ) -> List[Dict]:
        """
        Stateless retrieval: build a temporary index over the provided
        sections and return the top-k matching chunks. Ideal for serverless
        deployments where the client supplies the paper context.
        """
        docs = []
        for sec in sections:
            title = sec.get("title", "Untitled")
            content = sec.get("content", "")
            for chunk in _chunk_text(f"{title}\n{content}"):
                docs.append({"title": title, "content": chunk, "filename": ""})
        if not docs:
            return []
        return _TfidfIndex(docs).search(query, k=k)
