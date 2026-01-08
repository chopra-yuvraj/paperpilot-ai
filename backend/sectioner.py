import re
from typing import List, Dict

class Sectioner:
    """
    Splits academic paper text into logical sections based on heuristics.
    """
    
    def __init__(self):
        # Common section headers in Upper Case or Title Case
        self.section_headers = [
            "ABSTRACT", "INTRODUCTION", "RELATED WORK", "METHODOLOGY", "METHODS",
            "PROPOSED APPROACH", "EXPERIMENTS", "RESULTS", "DISCUSSION", 
            "CONCLUSION", "REFERENCES", "ACKNOWLEDGEMENTS"
        ]

    def extract_sections(self, text: str) -> List[Dict[str, str]]:
        """
        Splits text into sections.
        Returns a list of dicts: {'title': 'Introduction', 'content': '...'}
        """
        lines = text.split('\n')
        sections = []
        current_section = {"title": "Preamble", "content": ""}
        
        # Regex for section headers like "1. INTRODUCTION" or just "INTRODUCTION"
        # We look for lines that are short, all caps or distinctively title-like
        header_pattern = re.compile(r'^(\d+\.?\s*)?(' + '|'.join(self.section_headers) + r')\s*$', re.IGNORECASE)

        for line in lines:
            line_str = line.strip()
            if not line_str:
                continue
                
            match = header_pattern.match(line_str)
            if match:
                # Save previous section
                if current_section["content"].strip():
                   sections.append(current_section)
                
                # Start new section
                current_section = {
                    "title": line_str,
                    "content": ""
                }
            else:
                current_section["content"] += line + "\n"
        
        # Add last section
        if current_section["content"].strip():
            sections.append(current_section)
            
        return sections

if __name__ == "__main__":
    text = "ABSTRACT\nThis is the abstract.\n\n1. INTRODUCTION\nHere we introduce..."
    s = Sectioner()
    print(s.extract_sections(text))
