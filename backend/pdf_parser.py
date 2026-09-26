import io
import logging

from pypdf import PdfReader

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

        reader = PdfReader(file_input)
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"

    except Exception as e:
        logger.error(f"Error reading PDF: {e}")
        return ""

    return text.strip()
