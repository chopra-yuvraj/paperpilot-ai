"""
Vercel serverless entry point.
Imports the FastAPI app so Vercel can find and serve it.
"""
import sys
import os

# Ensure project root is in Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.main import app
