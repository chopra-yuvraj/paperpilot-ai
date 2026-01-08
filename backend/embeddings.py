from sentence_transformers import SentenceTransformer
import faiss
import numpy as np
import pickle
import os

class EmbeddingEngine:
    def __init__(self, model_name='all-MiniLM-L6-v2'):
        print(f"Loading embedding model: {model_name}...")
        self.model = SentenceTransformer(model_name)
        self.dimension = self.model.get_sentence_embedding_dimension()
        self.index = faiss.IndexFlatL2(self.dimension)
        self.metadata = [] # Stores mapping from index ID to text chunk/metadata

    def ingest_sections(self, sections: list):
        """
        Takes a list of section dicts, chunks them if necessary, and embeds them.
        sections: [{'title': '...', 'content': '...'}]
        """
        # Clear existing index for simplicity (per session/paper)
        self.index = faiss.IndexFlatL2(self.dimension)
        self.metadata = []
        
        corpus = []
        
        for sec in sections:
            # We treat the section content as the chunk for simplicity.
            # For very large sections, further chunking might be needed.
            # We simply truncate to reasonable length if needed or just embed.
            text = f"{sec['title']}: {sec['content']}"
            corpus.append(text)
            self.metadata.append(sec)
            
        if not corpus:
            return

        embeddings = self.model.encode(corpus)
        self.index.add(np.array(embeddings).astype('float32'))
        print(f"Indexed {len(corpus)} sections.")

    def search(self, query: str, k: int = 3):
        query_vector = self.model.encode([query])
        D, I = self.index.search(np.array(query_vector).astype('float32'), k)
        
        results = []
        for i, idx in enumerate(I[0]):
            if idx != -1 and idx < len(self.metadata):
                results.append(self.metadata[idx])
        return results

if __name__ == "__main__":
    engine = EmbeddingEngine()
    # test
