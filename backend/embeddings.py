from huggingface_hub import InferenceClient
import faiss
import numpy as np
import os
import time

class EmbeddingEngine:
    def __init__(self, model_name='sentence-transformers/all-MiniLM-L6-v2'):
        print(f"Initializing HF Inference API for embeddings: {model_name}...")
        self.model_name = model_name
        # Falls back to anonymous if no token, but might find rate limits.
        self.client = InferenceClient(model=model_name, token=os.getenv("HF_TOKEN"))
        
        # Hardcoded dimension for all-MiniLM-L6-v2 is 384. 
        # If we switch models, this might need updating or dynamic checking.
        self.dimension = 384 
        self.index = faiss.IndexFlatL2(self.dimension)
        self.metadata = [] 

    def _get_embedding(self, text: str):
        """
        Get embedding for a single string via API.
        We retry a few times in case of model loading (503).
        """
        for _ in range(3):
            try:
                # feature_extraction returns a list of floats (or list of lists if batch)
                # We force it to be a specific string.
                # The API usage: client.feature_extraction(text)
                response = self.client.feature_extraction(text)
                
                # If response is (seq_len, dim), we generally want the mean or CLS. 
                # However, for sentence-transformers models via API, 
                # it oftens returns the sentence embedding directly if handled by the pipeline?
                # Actually standard Feature Extraction pipeline returns (Batch, Seq, Dim).
                # We simply average if it comes back as a list of lists.
                
                arr = np.array(response)
                
                if arr.ndim == 1:
                    # Single vector
                    return arr
                elif arr.ndim == 2:
                    # (Seq, Dim) - Average pooling
                    return np.mean(arr, axis=0)
                elif arr.ndim == 3:
                     # (Batch, Seq, Dim) - but we sent one string
                     return np.mean(arr[0], axis=0)
                return arr
            except Exception as e:
                print(f"API Error (retrying): {e}")
                time.sleep(2)
        
        # Fallback if API fails
        return np.zeros(self.dimension)

    def ingest_sections(self, sections: list):
        """
        Takes a list of section dicts, gets embeddings from API, and indexes them.
        """
        # Clear existing index
        self.index = faiss.IndexFlatL2(self.dimension)
        self.metadata = []
        
        if not sections:
            return

        print(f"Embedding {len(sections)} sections via API...")
        
        vectors = []
        for sec in sections:
            text = f"{sec['title']}: {sec['content']}"
            # Truncate to avoid payload errors (API limits are usuall 10k chars or so)
            if len(text) > 2000: 
                text = text[:2000]
                
            emb = self._get_embedding(text)
            vectors.append(emb)
            self.metadata.append(sec)
            # Small delay to be nice to the API
            time.sleep(0.2)
            
        if vectors:
            # Add to FAISS
            matrix = np.array(vectors).astype('float32')
            self.index.add(matrix)
            print(f"Indexed {len(vectors)} sections.")

    def search(self, query: str, k: int = 3):
        query_vec = self._get_embedding(query)
        
        # Search
        D, I = self.index.search(np.array([query_vec]).astype('float32'), k)
        
        results = []
        for i, idx in enumerate(I[0]):
            if idx != -1 and idx < len(self.metadata):
                results.append(self.metadata[idx])
        return results

if __name__ == "__main__":
    eng = EmbeddingEngine()
    # Test
    # v = eng._get_embedding("Hello world")
    # print(v.shape)
