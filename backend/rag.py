import os
from huggingface_hub import InferenceClient
from typing import List

# default model to use
REPO_ID = "microsoft/Phi-3.5-mini-instruct"

class RAGController:
    def __init__(self):
        # try to get token from env
        token = os.getenv("HF_TOKEN")
        self.client = InferenceClient(model=REPO_ID, token=token)

    def generate_response(self, context_chunks, query, mode="explain"):
        # make context string
        context_text = ""
        for c in context_chunks:
            context_text += f"SECTION: {c['title']}\nCONTENT: {c['content']}\n\n"
        
        system_prompt = "You are an expert AI Research Copilot. Help students understand papers. Answer based on the text provided."

        if mode == "explain":
            user_prompt = f"""Context from paper:
{context_text}

Question: {query}

Explain this simply and clearly."""

        elif mode == "critique":
            user_prompt = f"""Context from paper:
{context_text}

Task: Critique the assumptions and methodology. Identify weaknesses or missing evidence."""

        else:
            user_prompt = f"Context:\n{context_text}\n\n{query}"

        # messages for chat api
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        try:
            # call api
            response = self.client.chat_completion(messages, max_tokens=1024)
            return response.choices[0].message.content
        except Exception as e:
            return f"Error: {e}. Check internet or HF_TOKEN."

if __name__ == "__main__":
    pass
