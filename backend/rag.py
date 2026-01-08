import os
from huggingface_hub import InferenceClient
from typing import List
from fastapi import HTTPException

# Registry from spec
PRIMARY_MODEL = "meta-llama/Llama-3.1-8B-Instruct"
FALLBACK_MODEL = "microsoft/Phi-3.5-mini-instruct"

class RAGController:
    def __init__(self):
        # Must use token with provider
        token = os.getenv("HF_TOKEN")
        self.client = InferenceClient(api_key=token)

    def generate_response(self, context_chunks: List[dict], query: str, mode: str = "explain") -> str:
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
            system_prompt = (
                "You are a critical peer reviewer for a top-tier CS conference. Analyze the provided methodology "
                "strictly. Identify potential data leakage, weak baselines, or unstated assumptions. "
                "Structure your response as: 1. Summary of Approach, 2. Strengths, 3. Critical Flaws/Weaknesses."
            )
            user_prompt = f"Context:\n{context_text}\n\nTask: Critique the methodology in this text."
            
        else:
            # Fallback/General
            system_prompt = "You are an expert AI Research Copilot."
            user_prompt = f"Context:\n{context_text}\n\n{query}"

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        # 3. Execute with Provider Routing & Fallback
        try:
            return self._call_model(PRIMARY_MODEL, messages, provider="together")
        except Exception as e:
            print(f"Primary model failed: {e}. Trying fallback...")
            try:
                return self._call_model(FALLBACK_MODEL, messages, provider="together")
            except Exception as e2:
                return f"Error: Both models failed. {e2}"

    def _call_model(self, model_id, messages, provider):
        """Helper to call HF Inference API with a specific provider"""
        response = self.client.chat.completions.create(
            model=model_id,
            messages=messages,
            max_tokens=2048, # Increased per spec
            temperature=0.3, # Low temp per spec
            provider=provider
        )
        return response.choices[0].message.content

if __name__ == "__main__":
    pass
