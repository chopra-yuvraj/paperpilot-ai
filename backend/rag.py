import os
from huggingface_hub import InferenceClient
from typing import List

# Use a default free model or one specified in env
REPO_ID = "mistralai/Mistral-7B-Instruct-v0.3"

class RAGController:
    def __init__(self):
        # We try to get token from env, else run anonymously (might be rate limited)
        token = os.getenv("HF_TOKEN")
        self.client = InferenceClient(model=REPO_ID, token=token)

    def generate_response(self, context_chunks: List[dict], query: str, mode: str = "explain") -> str:
        """
        Generates a response using the LLM with retrieved context.
        mode: 'explain', 'critique', 'simplify'
        """
        
        # Prepare context text
        context_text = "\n\n".join([f"SECTION: {c['title']}\nCONTENT: {c['content']}" for c in context_chunks])
        
        system_prompt = (
            "You are an expert AI Research Copilot. Your goal is to help students understand complex research papers. "
            "Always anchor your explanations to the provided text. If the answer is not in the text, say so."
        )

        if mode == "explain":
            user_prompt = (
                f"Context from paper:\n{context_text}\n\n"
                f"Question: {query}\n\n"
                "Explain the answer clearly and simply. Use analogies if helpful."
            )
        elif mode == "critique":
            user_prompt = (
                f"Context from paper:\n{context_text}\n\n"
                f"Task: Critique the assumptions and methodology mentioned in this text.\n"
                "Identify weaknesses, missing experiments, or strong claims without evidence."
            )
        else:
            user_prompt = f"Context:\n{context_text}\n\n{query}"

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        try:
            # Check for generic inference API
            response = self.client.chat_completion(messages, max_tokens=1024)
            return response.choices[0].message.content
        except Exception as e:
            return f"Error generating explanation: {e}. (Ensure you have a valid HF_TOKEN or check internet connection)"

if __name__ == "__main__":
    # Test
    pass
