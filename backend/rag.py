import os
import json
import re
import logging
from typing import List, Dict, Union, Any

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage, HumanMessage

logger = logging.getLogger(__name__)

# Gemini Configuration
MODEL_NAME = "gemini-1.5-flash"

SYSTEM_PROMPT_CRITIQUE = """\
You are an academic peer reviewer. Your task is to analyze research methodologies critically.
You must output your response in valid JSON format ONLY. Do not add any introductory or concluding text.

Use this exact JSON structure:
{
  "summary": "A concise 2-3 sentence summary of the methodology.",
  "strengths": [
    "Point 1",
    "Point 2"
  ],
  "weaknesses": [
    {
      "point": "Name of the weakness (e.g., 'Data Leakage')",
      "description": "Explanation of why this is a flaw."
    }
  ],
  "suggestions": [
    "Actionable suggestion 1",
    "Actionable suggestion 2"
  ]
}
"""

SYSTEM_PROMPT_EXPLAIN = """\
You are an expert academic tutor. Your goal is to explain complex research paper excerpts \
to an undergraduate computer science student. Break down technical jargon, identify the \
core logic, and use analogies where possible. Do not oversimplify the math, but explain \
it step-by-step. Format your response using Markdown for readability.\
"""

SYSTEM_PROMPT_GENERAL = """\
You are an expert AI Research Copilot. Answer the question based ONLY on the provided context. \
If the context does not contain enough information, say so honestly. Format your response \
using Markdown for readability.\
"""


def parse_json_response(response_text: str) -> dict:
    """Extract and parse a JSON object from LLM response text."""
    try:
        # Try to find JSON within markdown code fences first
        fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", response_text, re.DOTALL)
        if fence_match:
            return json.loads(fence_match.group(1))

        # Try to find raw JSON
        match = re.search(r"\{.*\}", response_text, re.DOTALL)
        if match:
            return json.loads(match.group(0))

        # Last resort: try parsing the entire text
        return json.loads(response_text)

    except json.JSONDecodeError:
        logger.warning("Failed to parse JSON from LLM response.")
        return {"error": "Invalid JSON format", "raw_text": response_text}


class RAGController:
    """Retrieval-Augmented Generation controller for paper analysis."""

    def __init__(self):
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY not found. Cannot initialize RAG.")

        self.llm = ChatGoogleGenerativeAI(
            model=MODEL_NAME,
            temperature=0.3,
            max_tokens=2048,
            google_api_key=api_key,
            convert_system_message_to_human=True,
        )
        logger.info(f"RAGController initialized with model: {MODEL_NAME}")

    def generate_response(
        self,
        context_chunks: List[Dict[str, str]],
        query: str,
        mode: str = "explain",
    ) -> str:
        """
        Generate an AI response based on context and query.

        Args:
            context_chunks: List of dicts with 'title' and 'content' keys.
            query: The user's question or instruction.
            mode: One of 'explain', 'critique', or 'general'.

        Returns:
            Formatted response string (Markdown).
        """
        # 1. Build context block
        context_parts = []
        for c in context_chunks:
            title = c.get("title", "Unknown Section")
            content = c.get("content", "")
            context_parts.append(f"SECTION: {title}\nCONTENT: {content}")
        context_text = "\n\n".join(context_parts)

        # 2. Select prompt by mode
        if mode == "explain":
            system_instruction = SYSTEM_PROMPT_EXPLAIN
            user_content = (
                f"Context:\n{context_text}\n\n"
                f"Question: {query}\n\n"
                "Explain this based strictly on the provided context. "
                "If the context is insufficient, state that clearly."
            )
        elif mode == "critique":
            system_instruction = SYSTEM_PROMPT_CRITIQUE
            user_content = (
                f"Analyze the following methodology section:\n\n"
                f'"{context_text}"\n\n'
                "Provide the critique in the required JSON format."
            )
        else:
            system_instruction = SYSTEM_PROMPT_GENERAL
            user_content = f"Context:\n{context_text}\n\nQuestion: {query}"

        messages = [
            SystemMessage(content=system_instruction),
            HumanMessage(content=user_content),
        ]

        # 3. Execute LLM call
        try:
            response = self.llm.invoke(messages)
            response_text = response.content

            if mode == "critique":
                json_data = parse_json_response(response_text)
                return self._format_critique_to_markdown(json_data)

            return response_text

        except Exception as e:
            logger.error(f"LLM generation failed: {e}")
            return f"⚠️ Error generating response: {str(e)}"

    def _format_critique_to_markdown(self, data: Union[Dict, Any]) -> str:
        """Convert structured critique JSON into readable Markdown."""
        if "error" in data:
            raw = data.get("raw_text", "")
            return (
                f"**⚠️ Error parsing critique:** {data['error']}\n\n"
                f"Raw output:\n```\n{raw}\n```"
            )

        parts = []

        # Summary
        summary = data.get("summary", "No summary provided.")
        parts.append(f"### 📋 Summary\n{summary}")

        # Strengths
        strengths = data.get("strengths", [])
        if strengths:
            items = "\n".join(f"- ✅ {s}" for s in strengths)
            parts.append(f"### 💪 Strengths\n{items}")

        # Weaknesses
        weaknesses = data.get("weaknesses", [])
        if weaknesses:
            items = []
            for w in weaknesses:
                if isinstance(w, dict):
                    point = w.get("point", "General")
                    desc = w.get("description", "")
                    items.append(f"- ⚠️ **{point}**: {desc}")
                else:
                    items.append(f"- ⚠️ {w}")
            parts.append(f"### 🔍 Weaknesses\n" + "\n".join(items))

        # Suggestions
        suggestions = data.get("suggestions", [])
        if suggestions:
            items = "\n".join(f"- 💡 {s}" for s in suggestions)
            parts.append(f"### 🚀 Suggestions\n{items}")

        return "\n\n".join(parts)
