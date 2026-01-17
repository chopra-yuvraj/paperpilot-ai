import os
from supabase import create_client, Client

url: str = os.getenv("SUPABASE_URL")
key: str = os.getenv("SUPABASE_KEY")

if not url or not key:
    print("WARNING: Supabase credentials not found in environment variables.")
    supabase: Client = None
else:
    supabase: Client = create_client(url, key)
