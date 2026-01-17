import os
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage, HumanMessage
from typing import List, Union, Any
import json
import re

# Gemini Configuration
MODEL_NAME = "gemini-1.5-flash"

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
    try:
        match = re.search(r"\{.*\}", response_text, re.DOTALL)
        if match:
            json_str = match.group(0)
            return json.loads(json_str)
        else:
            # Try parsing raw if no brackets found (sometimes models just output json)
            return json.loads(response_text)
    except json.JSONDecodeError:
        return {"error": "Invalid JSON format", "raw_text": response_text}

class RAGController:
    def __init__(self):
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            print("WARNING: GEMINI_API_KEY not found.")
            
        self.llm = ChatGoogleGenerativeAI(
            model=MODEL_NAME,
            temperature=0.3,
            max_tokens=2048,
            google_api_key=api_key,
            convert_system_message_to_human=True # Gemini sometimes prefers this
        )

    def generate_response(self, context_chunks: List[dict], query: str, mode: str = "explain"):
        # 1. Prepare Context
        context_text = ""
        for c in context_chunks:
            title = c.get('title', 'Unknown Section')
            content = c.get('content', '')
            context_text += f"SECTION: {title}\nCONTENT: {content}\n\n"
        
        # 2. Select Prompts
        if mode == "explain":
            system_instruction = (
                "You are an expert academic tutor. Your goal is to explain complex research paper excerpts "
                "to an undergraduate computer science student. Break down technical jargon, identify the "
                "core logic, and use analogies where possible. Do not oversimplify the math, but explain it step-by-step."
            )
            user_content = f"Context:\n{context_text}\n\nQuestion: {query}\n\nExplain this section based strictly on the provided context. If the context is insufficient, state that you cannot answer."
            
        elif mode == "critique":
            system_instruction = SYSTEM_PROMPT_CRITIQUE
            user_content = f"Analyze the following methodology section:\n\n\"{context_text}\"\n\nProvide the critique in the required JSON format."
            
        else:
            # Fallback/General
            system_instruction = "You are an expert AI Research Copilot. Answer the question based ONLY on the provided context."
            user_content = f"Context:\n{context_text}\n\nQuestion: {query}"

        messages = [
            SystemMessage(content=system_instruction),
            HumanMessage(content=user_content)
        ]
        
        # 3. Execute
        try:
            response = self.llm.invoke(messages)
            response_text = response.content
            
            if mode == "critique":
                json_response = parse_json_response(response_text)
                return self._format_critique_to_markdown(json_response)
            
            return response_text
        except Exception as e:
            return f"Error generating response: {str(e)}"

    def _format_critique_to_markdown(self, data: Union[dict, Any]) -> str:
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
