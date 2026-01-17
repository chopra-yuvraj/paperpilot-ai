import os
import time
import uuid
import numpy as np
from pinecone import Pinecone, ServerlessSpec
from sentence_transformers import SentenceTransformer

class EmbeddingEngine:
    def __init__(self, model_name='sentence-transformers/all-MiniLM-L6-v2'):
        print(f"Setting up embeddings: {model_name}...")
        self.model_name = model_name
        self.encoder = SentenceTransformer(model_name)
        self.dimension = 384
        
        # Pinecone setup
        self.api_key = os.getenv("PINECONE_API_KEY")
        if not self.api_key:
            print("WARNING: PINECONE_API_KEY not found.")
        
        self.pc = Pinecone(api_key=self.api_key)
        self.index_name = os.getenv("PINECONE_INDEX", "paperpilot-index")
        
        # Check if index exists, if not create it (Serverless)
        # Note: In production, index creation usually happens outside app startup to save time/errors
        # But for this setup we'll check gently
        existing_indexes = [i.name for i in self.pc.list_indexes()]
        if self.index_name not in existing_indexes:
            try:
                print(f"Creating Pinecone index: {self.index_name}")
                self.pc.create_index(
                    name=self.index_name,
                    dimension=self.dimension,
                    metric="cosine",
                    spec=ServerlessSpec(
                        cloud="aws",
                        region=os.getenv("PINECONE_ENV", "us-east-1")
                    )
                )
                # Wait for index to be ready
                while not self.pc.describe_index(self.index_name).status['ready']:
                    time.sleep(1)
            except Exception as e:
                print(f"Error creating index (might already exist or permission issue): {e}")

        self.index = self.pc.Index(self.index_name)

    def _get_embedding(self, text):
        # Local embedding generation (CPU/Fast)
        return self.encoder.encode(text).tolist()

    def ingest_sections(self, sections, filename="unknown"):
        if not sections:
            return

        print(f"Processing {len(sections)} sections for {filename}...")
        
        vectors = []
        for sec in sections:
            title = sec.get('title', 'Untitled')
            content = sec.get('content', '')
            text = f"{title}: {content}"
            
            # Truncate if necessary (though Pinecone metadata has limits, embedding handles long text by truncation usually)
            # sentence-transformers usually truncates to 256/512 tokens automatically
            
            vector = self._get_embedding(text)
            
            # Metadata for retrieval
            # Keep metadata small for Pinecone performance
            metadata = {
                "title": title,
                "content": content[:4000], # Limit content in metadata to avoid size errors (40KB max)
                "filename": filename
            }
            
            # Use unique ID
            vec_id = str(uuid.uuid4())
            vectors.append({
                "id": vec_id,
                "values": vector,
                "metadata": metadata
            })
            
        # Batch upsert
        batch_size = 100
        for i in range(0, len(vectors), batch_size):
            batch = vectors[i:i+batch_size]
            self.index.upsert(vectors=batch)
            
        print(f"Upserted {len(vectors)} vectors to Pinecone.")

    def search(self, query, k=5):
        query_vec = self._get_embedding(query)
        
        try:
            results = self.index.query(
                vector=query_vec,
                top_k=k,
                include_metadata=True
            )
            
            matches = []
            for match in results['matches']:
                matches.append(match['metadata'])
                
            return matches
        except Exception as e:
            print(f"Search failed: {e}")
            return []
