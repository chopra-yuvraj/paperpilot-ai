import logging
from typing import List, Dict

from .rag import RAGController

logger = logging.getLogger(__name__)


class Critic:
    """Provides AI-powered critique and improvement suggestions for paper sections."""

    def __init__(self, rag_client: RAGController):
        self.rag = rag_client

    def critique_section(self, section_data: Dict[str, str]) -> str:
        """
        Generate a structured critique for a single paper section.

        Args:
            section_data: Dict with 'title' and 'content' keys.

        Returns:
            Markdown-formatted critique string.
        """
        return self.rag.generate_response(
            [section_data], "Critique this section.", mode="critique"
        )

    def suggest_improvements(self, context_chunks: List[Dict[str, str]]) -> str:
        """
        Suggest concrete future experiments based on the provided sections.

        Args:
            context_chunks: List of section dicts.

        Returns:
            Markdown-formatted suggestions string.
        """
        prompt = "Based on these sections, suggest 3 concrete future experiments."
        return self.rag.generate_response(context_chunks, prompt, mode="explain")
