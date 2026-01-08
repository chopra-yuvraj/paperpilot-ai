import pdfplumber
from pathlib import Path

def parse_pdf(file_path: str) -> str:
    """
    Extracts text from a PDF file using pdfplumber.
    
    Args:
        file_path (str): Path to the PDF file.
        
    Returns:
        str: Extracted text from the PDF.
    """
    text = ""
    try:
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
    except Exception as e:
        print(f"Error reading PDF {file_path}: {e}")
        return ""
        
    return text

if __name__ == "__main__":
    # fast test
    pass
