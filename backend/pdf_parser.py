import json
import re

def parse_json_response(response_text):
    # Extract JSON blob between { and } if model adds extra text
    try:
        match = re.search(r"\{.*\}", response_text, re.DOTALL)
        if match:
            json_str = match.group(0)
            return json.loads(json_str)
        else:
            return {"error": "Failed to parse JSON", "raw_text": response_text}
    except json.JSONDecodeError:
        return {"error": "Invalid JSON format", "raw_text": response_text}

def parse_pdf(file_path):
    text = ""
    try:
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    text += t + "\n"
    except Exception as e:
        print(f"Error reading PDF: {e}")
        return ""
        
    return text

if __name__ == "__main__":
    pass
