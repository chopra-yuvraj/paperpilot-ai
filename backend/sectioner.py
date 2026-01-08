import re

class Sectioner:
    def __init__(self):
        # headers we look for
        self.headers = [
            "ABSTRACT", "INTRODUCTION", "RELATED WORK", "METHODOLOGY", "METHODS",
            "PROPOSED APPROACH", "EXPERIMENTS", "RESULTS", "DISCUSSION", 
            "CONCLUSION", "REFERENCES", "ACKNOWLEDGEMENTS"
        ]

    def extract_sections(self, text):
        lines = text.split('\n')
        sections = []
        current = {"title": "Preamble", "content": ""}
        
        # look for headers like "1. INTRODUCTION" or just "INTRODUCTION"
        pattern = re.compile(r'^(\d+\.?\s*)?(' + '|'.join(self.headers) + r')\s*$', re.IGNORECASE)

        for line in lines:
            s_line = line.strip()
            if not s_line:
                continue
                
            if pattern.match(s_line):
                # save old section if it has stuff
                if current["content"].strip():
                   sections.append(current)
                
                # start new one
                current = {
                    "title": s_line,
                    "content": ""
                }
            else:
                current["content"] += line + "\n"
        
        # add last one
        if current["content"].strip():
            sections.append(current)
            
        return sections

if __name__ == "__main__":
    pass
