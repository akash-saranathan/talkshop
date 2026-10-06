"""
LLM provider resolution — checked once at startup.
Priority: Gemini (API key) → hard stop with instructions.
Ollama skipped per user config (Google API key available).
"""
import os
import sys
from dotenv import load_dotenv

load_dotenv()

MODEL_NAME = "gemini-3.5-flash-lite"
_resolved: dict | None = None


def get_llm(temperature: float = 0.1, timeout: float | None = None, max_retries: int | None = None):
    """Return a configured ChatGoogleGenerativeAI instance. timeout/max_retries
    let latency-sensitive callers (Talkshop) fail fast instead of sitting in
    the client's default retry backoff when the API rate-limits."""
    from langchain_google_genai import ChatGoogleGenerativeAI
    api_key = os.getenv("GOOGLE_API_KEY", "")
    if not api_key:
        _hard_stop()
    extra = {}
    if timeout is not None:
        extra["timeout"] = timeout
    if max_retries is not None:
        extra["max_retries"] = max_retries
    return ChatGoogleGenerativeAI(
        model=MODEL_NAME,
        temperature=temperature,
        google_api_key=api_key,
        **extra,
    )


def resolve_llm() -> dict:
    """
    Run the startup LLM check. Returns info dict if successful.
    Call once during app lifespan; result cached in _resolved.
    """
    global _resolved
    if _resolved is not None:
        return _resolved

    api_key = os.getenv("GOOGLE_API_KEY", "")
    if not api_key:
        _hard_stop()

    _resolved = {"provider": "gemini", "model": MODEL_NAME}
    return _resolved


def _hard_stop():
    print("\n[ERROR] No LLM configured. Set GOOGLE_API_KEY in .env")
    print("  Option: add GOOGLE_API_KEY=<your-key> to .env")
    sys.exit(1)
