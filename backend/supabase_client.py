import os
import logging

logger = logging.getLogger(__name__)

supabase = None

try:
    from supabase import create_client, Client

    url: str = os.getenv("SUPABASE_URL", "")
    key: str = os.getenv("SUPABASE_KEY", "")

    if url and key:
        supabase: Client = create_client(url, key)
        logger.info("Supabase client initialized successfully.")
    else:
        logger.warning(
            "Supabase credentials not found in environment variables. "
            "Storage features will be disabled."
        )
except ImportError:
    logger.warning(
        "supabase package not installed. Storage features will be disabled."
    )
except Exception as e:
    logger.error(f"Failed to initialize Supabase client: {e}")
