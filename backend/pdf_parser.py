import io
import logging

import pdfplumber

logger = logging.getLogger(__name__)


def parse_pdf(file_input) -> str:
    """
    Parses text content from a PDF file.

    Args:
        file_input: A file path (str) or a file-like object (io.BytesIO).

    Returns:
        Extracted text as a string, or empty string on failure.
    """
    text = ""
    try:
        # Ensure BytesIO cursor is at the start
        if isinstance(file_input, io.BytesIO):
            file_input.seek(0)

        with pdfplumber.open(file_input) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"

    except Exception as e:
        logger.error(f"Error reading PDF: {e}")
        return ""

    return text.strip()
