from huggingface_hub import InferenceClient
import faiss
import numpy as np
import os
import time

class EmbeddingEngine:
    def __init__(self, model_name='sentence-transformers/all-MiniLM-L6-v2'):
        print(f"Setting up embeddings: {model_name}...")
        self.model_name = model_name
        self.client = InferenceClient(model=model_name, token=os.getenv("HF_TOKEN"))
        
        # model dim is 384
        self.dimension = 384 
        self.index = faiss.IndexFlatL2(self.dimension)
        self.metadata = [] 

    def _get_embedding(self, text):
        # try 3 times incase api fails
        for i in range(3):
            try:
                # get features
                response = self.client.feature_extraction(text)
                arr = np.array(response)
                
                # handle different shapes
                if arr.ndim == 1:
                    return arr
                elif arr.ndim == 2:
                    return np.mean(arr, axis=0)
                elif arr.ndim == 3:
                     return np.mean(arr[0], axis=0)
                return arr
            except Exception as e:
                print(f"Retrying... {e}")
                time.sleep(2)
        
        # return empty if failed
        return np.zeros(self.dimension)

    def ingest_sections(self, sections):
        # clear old index
        self.index = faiss.IndexFlatL2(self.dimension)
        self.metadata = []
        
        if not sections:
            return

        print(f"Processing {len(sections)} sections...")
        
        vectors = []
        for sec in sections:
            # combine title and text
            text = f"{sec['title']}: {sec['content']}"
            
            # cut off if too long
            if len(text) > 2000: 
                text = text[:2000]
                
            emb = self._get_embedding(text)
            vectors.append(emb)
            self.metadata.append(sec)
            
            # sleep a bit
            time.sleep(0.2)
            
        if vectors:
            # add to faiss
            matrix = np.array(vectors).astype('float32')
            self.index.add(matrix)
            print(f"Done. Indexed {len(vectors)} items.")

    def search(self, query, k=3):
        # get query vector
        query_vec = self._get_embedding(query)
        
        # search index
        D, I = self.index.search(np.array([query_vec]).astype('float32'), k)
        
        results = []
        for i, idx in enumerate(I[0]):
            if idx != -1 and idx < len(self.metadata):
                results.append(self.metadata[idx])
        return results

if __name__ == "__main__":
    eng = EmbeddingEngine()

