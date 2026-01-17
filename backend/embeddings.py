import os
import time
import uuid
from pinecone import Pinecone, ServerlessSpec
from langchain_google_genai import GoogleGenerativeAIEmbeddings

class EmbeddingEngine:
    def __init__(self, model_name="models/text-embedding-004"):
        print(f"Setting up embeddings: {model_name}...")
        self.model_name = model_name
        
        # Google Gemini Embeddings setup
        self.api_key = os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            print("WARNING: GEMINI_API_KEY not found. Embeddings will fail.")
            
        self.encoder = GoogleGenerativeAIEmbeddings(
            model=model_name,
            google_api_key=self.api_key
        )
        self.dimension = 768
        
        # Pinecone setup
        self.pinecone_api_key = os.getenv("PINECONE_API_KEY")
        self.index_name = os.getenv("PINECONE_INDEX", "paperpilot-index")
        self.pc = None
        self.index = None

        if self.pinecone_api_key:
            try:
                self.pc = Pinecone(api_key=self.pinecone_api_key)
                self.index = self.pc.Index(self.index_name)
            except Exception as e:
                print(f"Pinecone client init failed (non-fatal for startup): {e}")
        else:
             print("WARNING: PINECONE_API_KEY not found.")

    def ensure_index_exists(self):
        """
        Check if index exists and create if needed.
        Note: This might still fail if the API key is invalid or permissions are missing.
        """
        if not self.pc:
             return
             
        try:
            existing_indexes = [i.name for i in self.pc.list_indexes()]
            if self.index_name not in existing_indexes:
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
        except Exception as e:
            print(f"Index creation check failed: {e}")

    def _get_embedding(self, text):
        # Use Google Gemini API
        return self.encoder.embed_query(text)

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
