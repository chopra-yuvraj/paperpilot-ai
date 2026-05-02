import re
import logging
from typing import List, Dict

logger = logging.getLogger(__name__)

# Standard academic paper section headers
DEFAULT_HEADERS = [
    "ABSTRACT", "INTRODUCTION", "RELATED WORK", "BACKGROUND",
    "LITERATURE REVIEW", "METHODOLOGY", "METHODS", "MATERIALS AND METHODS",
    "PROPOSED APPROACH", "PROPOSED METHOD", "SYSTEM DESIGN",
    "IMPLEMENTATION", "EXPERIMENTS", "EXPERIMENTAL SETUP",
    "RESULTS", "RESULTS AND DISCUSSION", "EVALUATION",
    "DISCUSSION", "ANALYSIS", "LIMITATIONS",
    "CONCLUSION", "CONCLUSIONS", "FUTURE WORK",
    "REFERENCES", "BIBLIOGRAPHY", "ACKNOWLEDGEMENTS", "APPENDIX",
]


class Sectioner:
    """Splits raw paper text into titled sections based on header patterns."""

    def __init__(self, headers: List[str] = None):
        self.headers = headers or DEFAULT_HEADERS
        # Match patterns like "1. INTRODUCTION", "2 Methodology", "III. Results"
        escaped = [re.escape(h) for h in self.headers]
        header_group = "|".join(escaped)
        self._pattern = re.compile(
            rf"^\s*(?:\d+\.?\s*|[IVXLC]+\.?\s*)?({header_group})\s*$",
            re.IGNORECASE,
        )

    def extract_sections(self, text: str) -> List[Dict[str, str]]:
        """
        Split text into sections based on recognized academic headers.

        Args:
            text: Full extracted text from a PDF.

        Returns:
            List of dicts with 'title' and 'content' keys.
        """
        if not text or not text.strip():
            logger.warning("Empty text provided to sectioner.")
            return []

        lines = text.split("\n")
        sections: List[Dict[str, str]] = []
        current = {"title": "Preamble", "content": ""}

        for line in lines:
            stripped = line.strip()
            if not stripped:
                # Preserve paragraph breaks in content
                current["content"] += "\n"
                continue

            if self._pattern.match(stripped):
                # Save previous section if it has content
                if current["content"].strip():
                    sections.append(current)

                # Start a new section with title-cased header
                current = {
                    "title": stripped.title(),
                    "content": "",
                }
            else:
                current["content"] += line + "\n"

        # Append the final section
        if current["content"].strip():
            sections.append(current)

        logger.info(f"Extracted {len(sections)} sections from paper.")
        return sections
