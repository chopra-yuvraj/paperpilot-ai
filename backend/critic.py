from .rag import RAGController

class Critic:
    def __init__(self, rag_client: RAGController):
        self.rag = rag_client

    def critique_section(self, section_data: dict) -> str:
        """
        Generates a critique for a specific section.
        """
        # We pass the single section as context
        return self.rag.generate_response([section_data], "Critique this section.", mode="critique")

    def suggest_improvements(self, context_chunks: list) -> str:
        """
        Suggests improvements based on context.
        """
        prompt = "Based on these sections, suggest 3 concrete future experiments or methodological improvements."
        return self.rag.generate_response(context_chunks, prompt, mode="explain")
