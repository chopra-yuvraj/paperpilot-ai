import os
from huggingface_hub import InferenceClient
from typing import List, Union, Any
from fastapi import HTTPException
import json
import re

# Registry from spec
PRIMARY_MODEL = "meta-llama/Llama-3.1-8B-Instruct"
FALLBACK_MODEL = "Qwen/Qwen2.5-7B-Instruct"

SYSTEM_PROMPT_CRITIQUE = """
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


class RAGController:
    def __init__(self):
        # We don't initialize a single client anymore, we do it per call if needed
        # or we could keep a default one. 
        self.token = os.getenv("HF_TOKEN")

    def _get_client(self, provider=None):
        """Factory to get client with provider"""
        return InferenceClient(api_key=self.token, provider=provider)

    def generate_response(self, context_chunks: List[dict], query: str, mode: str = "explain"):
        # 1. Prepare Context
        context_text = ""
        for c in context_chunks:
            context_text += f"SECTION: {c['title']}\nCONTENT: {c['content']}\n\n"
        
        # 2. Select Prompts based on spec scenarios
        if mode == "explain":
            # Scenario A: Simplification (The "Explainer")
            system_prompt = (
                "You are an expert academic tutor. Your goal is to explain complex research paper excerpts "
                "to an undergraduate computer science student. Break down technical jargon, identify the "
                "core logic, and use analogies where possible. Do not oversimplify the math, but explain it step-by-step."
            )
            user_prompt = f"Context:\n{context_text}\n\nQuestion: {query}\n\nExplain this section based on the context."
            
        elif mode == "critique":
            # Scenario B: Methodology Critique (The "Reviewer")
            system_prompt = SYSTEM_PROMPT_CRITIQUE
            user_prompt = f"Analyze the following methodology section:\n\n\"{context_text}\"\n\nProvide the critique in the required JSON format."
            
        else:
            # Fallback/General
            system_prompt = "You are an expert AI Research Copilot."
            user_prompt = f"Context:\n{context_text}\n\n{query}"

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        # 3. Execute with Provider Routing & Fallback
        response_text = self._execute_model_chain(messages)
        
        if mode == "critique":
            json_response = parse_json_response(response_text)
            return self._format_critique_to_markdown(json_response)
        return response_text

    def _format_critique_to_markdown(self, data: Union[dict, Any]) -> str:
        """Converts the JSON critique logic into a readable Markdown report."""
        if "error" in data:
            return f"**Error parsing critique:** {data['error']}\n\nRaw output:\n```\n{data.get('raw_text', '')}\n```"

        md_output = f"### Critique Summary\n{data.get('summary', 'No summary provided.')}\n\n"
        
        md_output += "#### Strengths\n"
        for strength in data.get('strengths', []):
            md_output += f"- {strength}\n"
        md_output += "\n"

        md_output += "#### Weaknesses\n"
        for weakness in data.get('weaknesses', []):
            point = weakness.get('point', 'General')
            desc = weakness.get('description', '')
            md_output += f"- **{point}**: {desc}\n"
        md_output += "\n"

        md_output += "#### Suggestions\n"
        for suggestion in data.get('suggestions', []):
            md_output += f"- {suggestion}\n"
            
        return md_output

    def _execute_model_chain(self, messages):
        try:
            return self._call_model(PRIMARY_MODEL, messages, provider="together")
        except Exception as e:
            print(f"Primary model failed: {e}. Trying fallback to Qwen...")
            try:
                # Fallback to Qwen on Together
                return self._call_model(FALLBACK_MODEL, messages, provider="together")
            except Exception as e2:
                # If that fails, try generic serverless (no provider arg)
                try:
                     print(f"Fallback failed: {e2}. Trying generic serverless...")
                     return self._call_model(FALLBACK_MODEL, messages, provider=None)
                except Exception as e3:
                    return f"Error: All AI models unavailable. {e3}"

    def _call_model(self, model_id, messages, provider):
        """Helper to call HF Inference API with a specific provider"""
        client = self._get_client(provider)
        
        response = client.chat.completions.create(
            model=model_id,
            messages=messages,
            max_tokens=2048,
            temperature=0.3, 
            stream=False
        )
        return response.choices[0].message.content

if __name__ == "__main__":
    pass
