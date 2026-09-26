import os
import re
import json
import time
import logging
from typing import List, Dict, Tuple, Optional

import requests

logger = logging.getLogger(__name__)

# Groq Configuration
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
REQUEST_TIMEOUT = 90

# ---------------------------------------------------------------------------
# Model registry
# Only chat-capable models available on the Groq free tier are listed here.
# "auto" (handled below) routes each task to the best model and falls back
# to alternative models if the primary one is rate-limited.
# ---------------------------------------------------------------------------
DEFAULT_MODEL = "openai/gpt-oss-120b"
FAST_MODEL = "openai/gpt-oss-20b"

AVAILABLE_MODELS: Dict[str, Dict[str, str]] = {
    "openai/gpt-oss-120b": {
        "label": "GPT-OSS 120B",
        "description": "Best quality reasoning and explanations",
    },
    "openai/gpt-oss-20b": {
        "label": "GPT-OSS 20B",
        "description": "Fastest responses, lighter quality",
    },
    "qwen/qwen3.8-27b": {
        "label": "Qwen 3.8 27B",
        "description": "Balanced quality and speed",
    },
    "allam-2-7b": {
        "label": "ALLaM 2 7B",
        "description": "Lightweight, very fast",
    },
}

# Task -> preferred model under "auto"
AUTO_PRIMARY = {
    "explain": DEFAULT_MODEL,
    "critique": DEFAULT_MODEL,
    "general": DEFAULT_MODEL,
    "chat": DEFAULT_MODEL,
}

# Order used when the preferred model is rate-limited etc.
AUTO_FALLBACKS = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b", "allam-2-7b"]

# Output / input budgeting keeps us far below free-tier token limits
MAX_TOKENS = {"explain": 900, "critique": 900, "analysis": 1100, "chat": 700, "general": 700}
MAX_CONTEXT_CHARS = 3000
MAX_CHUNK_CHARS = 800

# Friendly, UI-safe error messages (never leak raw API JSON to the client)
ERR_RATE_LIMITED = (
    "The AI service is rate-limited right now. Please wait a few seconds and try again."
)
ERR_UNAVAILABLE = (
    "The AI service is temporarily unavailable. Please try again in a moment."
)

WAIT_RE = re.compile(r"try again in ([\d.]+)\s*s", re.IGNORECASE)


class GroqAPIError(Exception):
    """Internal error carrying HTTP status and a UI-safe message."""

    def __init__(self, status: int, message: str, wait_seconds: float = 0.0):
        super().__init__(message)
        self.status = status
        self.wait_seconds = wait_seconds


SYSTEM_PROMPT_ANALYSIS = """\
You are an expert academic tutor and peer reviewer. Analyze the provided section of a research \
paper and respond with VALID JSON ONLY — no preamble, no code fences.

Use exactly this structure:
{
  "explanation": "Markdown string, MAX 150 words. Explain the section to an undergraduate CS \
student using 3-6 short bullet points. **Bold** key terms. No headings, no code blocks.",
  "summary": "1-2 sentence summary of the section",
  "strengths": ["short point", "short point"],
  "weaknesses": [{"point": "short name", "description": "one sentence why"}],
  "suggestions": ["short actionable suggestion", "short actionable suggestion"]
}
Keep every field concise. 2-4 items for strengths, weaknesses and suggestions.\
"""

SYSTEM_PROMPT_CHAT = """\
You are an AI Research Copilot. Answer the question using ONLY the provided context chunks. \
Rules: MAX 150 words. Use short bullet points. **Bold** key terms. No headings, no tables, \
no code fences. If the context does not contain the answer, say so in one sentence.\
"""

SYSTEM_PROMPT_EXPLAIN = """\
You are an expert academic tutor. Explain the provided research excerpt to an undergraduate \
CS student. Rules: MAX 150 words, 3-6 short bullet points, **bold** key terms, \
no headings, no code fences.\
"""


def parse_json_response(response_text: str) -> dict:
    """Extract and parse a JSON object from LLM response text."""
    text = response_text.strip()
    try:
        fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
        if fence:
            return json.loads(fence.group(1))
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        return json.loads(text)
    except json.JSONDecodeError:
        logger.warning("Failed to parse JSON from LLM response.")
        return {"error": "Invalid JSON format", "raw_text": response_text}


class RAGController:
    """Generation controller backed by the Groq API with resilience built in."""

    def __init__(self):
        self.api_key = os.getenv("GROQ_API_KEY")
        if not self.api_key:
            raise ValueError("GROQ_API_KEY not found in environment.")
        self.default_model = os.getenv("GROQ_MODEL", DEFAULT_MODEL)
        logger.info(f"RAGController ready (default model: {self.default_model})")

    # ------------------------------------------------------------------
    # Model resolution
    # ------------------------------------------------------------------
    def resolve_chain(self, requested: Optional[str], mode: str) -> List[str]:
        """
        Turn a requested model into an ordered list of models to try.

        - Explicit model -> that model only (respect the user's choice).
        - "auto" / None  -> best model for the task, then fallbacks.
        """
        if requested and requested != "auto":
            if requested in AVAILABLE_MODELS:
                return [requested]
            logger.warning(f"Unknown model '{requested}' requested; falling back to auto.")

        primary = AUTO_PRIMARY.get(mode, DEFAULT_MODEL)
        chain = [primary] + [m for m in AUTO_FALLBACKS if m != primary]
        return chain

    @staticmethod
    def available_models_payload() -> dict:
        models = [
            {
                "id": "auto",
                "label": "Auto",
                "description": "Recommended - picks the best model for each task "
                "and retries with fallbacks if one is busy",
            }
        ]
        models += [
            {"id": mid, "label": info["label"], "description": info["description"]}
            for mid, info in AVAILABLE_MODELS.items()
        ]
        return {"default": "auto", "models": models}

    # ------------------------------------------------------------------
    # Low-level Groq call with retry / backoff / model fallback
    # ------------------------------------------------------------------
    def _single_call(self, model: str, messages: List[dict], max_tokens: int) -> str:
        try:
            response = requests.post(
                GROQ_API_URL,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": 0.3,
                    "max_tokens": max_tokens,
                },
                timeout=REQUEST_TIMEOUT,
            )
        except requests.RequestException as e:
            raise GroqAPIError(503, f"Network error contacting Groq: {e}") from e

        if response.status_code == 200:
            data = response.json()
            return data["choices"][0]["message"]["content"]

        # Parse provider detail for logging; keep user-facing text clean
        detail = response.text[:400]
        logger.warning(f"Groq error {response.status_code} on {model}: {detail}")

        if response.status_code == 429:
            m = WAIT_RE.search(detail)
            wait = float(m.group(1)) if m else 0.0
            raise GroqAPIError(429, "rate limited", wait_seconds=wait)
        if response.status_code in (500, 502, 503, 504):
            raise GroqAPIError(response.status_code, "provider error")
        # 400/401/404 etc. -> not worth retrying on the same model
        raise GroqAPIError(response.status_code, f"request rejected: {detail}")

    def _chat(self, system: str, user: str, *, mode: str, model: Optional[str] = None) -> Tuple[str, str]:
        """
        Call Groq with the model chain for this task.
        Returns (text, model_used). Raises GroqAPIError if everything failed.
        """
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        max_tokens = MAX_TOKENS.get(mode, 700)
        chain = self.resolve_chain(model, mode)

        last_err: Optional[GroqAPIError] = None
        for mi, current_model in enumerate(chain):
            for attempt in range(3):
                try:
                    text = self._single_call(current_model, messages, max_tokens)
                    if current_model != chain[0]:
                        logger.info(f"Served by fallback model: {current_model}")
                    return text, current_model
                except GroqAPIError as e:
                    last_err = e
                    if e.status == 429:
                        # Wait out the window (capped), then retry; after 2
                        # retries on this model move to the next model in the chain
                        if attempt < 2 and mi == 0:
                            wait = min(e.wait_seconds + 1.5, 30.0)
                            logger.info(f"Rate limited on {current_model}; waiting {wait:.1f}s")
                            time.sleep(wait)
                        else:
                            break  # try next model in chain
                    elif e.status in (500, 502, 503, 504) and attempt < 2:
                        time.sleep(2.0 * (attempt + 1))
                    else:
                        break  # non-retryable on this model

        if last_err and last_err.status == 429:
            raise GroqAPIError(429, ERR_RATE_LIMITED)
        raise GroqAPIError(503, ERR_UNAVAILABLE)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def generate_response(
        self,
        context_chunks: List[Dict[str, str]],
        query: str,
        mode: str = "general",
        model: Optional[str] = None,
    ) -> str:
        """Grounded chat / explanation answer (concise Markdown)."""
        context_parts = []
        for c in context_chunks:
            title = c.get("title", "Section")
            content = (c.get("content", "") or "")[:MAX_CHUNK_CHARS]
            context_parts.append(f"{title}: {content}")
        context_text = "\n\n".join(context_parts)[:MAX_CONTEXT_CHARS]

        if mode == "explain":
            system = SYSTEM_PROMPT_EXPLAIN
            user = f"Paper excerpt:\n{context_text}\n\nInstruction: {query}"
        else:
            system = SYSTEM_PROMPT_CHAT
            user = f"Context:\n{context_text}\n\nQuestion: {query}"

        text, _used = self._chat(system, user, mode=mode, model=model)
        return text.strip()

    def analyze_section(
        self, title: str, content: str, model: Optional[str] = None
    ) -> Dict[str, str]:
        """
        Single-call section analysis producing both the explanation and the
        critique (halves API usage vs. two separate calls).
        Returns {"explanation": md, "critique": md}.
        """
        excerpt = (content or "")[:MAX_CONTEXT_CHARS]
        user = f'Section title: "{title}"\n\nSection content:\n{excerpt}'

        raw, _used = self._chat(SYSTEM_PROMPT_ANALYSIS, user, mode="analysis", model=model)
        data = parse_json_response(raw)

        if "error" in data:
            # Model did not produce JSON - treat the whole reply as explanation
            logger.warning("Analysis returned non-JSON; using raw text as explanation.")
            return {"explanation": raw.strip(), "critique": ""}

        explanation = str(data.get("explanation", "")).strip() or "No explanation generated."
        critique = self._format_critique_to_markdown(data)
        return {"explanation": explanation, "critique": critique}

    # ------------------------------------------------------------------
    def _format_critique_to_markdown(self, data: dict) -> str:
        """Convert the structured critique fields into compact Markdown."""
        parts = []

        summary = str(data.get("summary", "")).strip()
        if summary:
            parts.append(f"**Summary:** {summary}")

        strengths = data.get("strengths") or []
        if strengths:
            items = "\n".join(f"- {s}" for s in strengths[:4])
            parts.append(f"**Strengths**\n{items}")

        weaknesses = data.get("weaknesses") or []
        if weaknesses:
            lines = []
            for w in weaknesses[:4]:
                if isinstance(w, dict):
                    lines.append(f"- **{w.get('point', 'Issue')}** - {w.get('description', '')}")
                else:
                    lines.append(f"- {w}")
            parts.append("**Weaknesses**\n" + "\n".join(lines))

        suggestions = data.get("suggestions") or []
        if suggestions:
            items = "\n".join(f"- {s}" for s in suggestions[:4])
            parts.append(f"**Suggestions**\n{items}")

        return "\n\n".join(parts)
