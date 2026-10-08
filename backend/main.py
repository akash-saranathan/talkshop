import os
import tempfile
from contextlib import AsyncExitStack, asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from backend.db.init_db import init_db, run as seed_db
from backend.routers import auth, merchants, products, chat, authorizations, payments, cart, compare, loyalty
from backend.routers import a2a as a2a_router
from backend.routers import generic_chat as generic_chat_router
from backend.routers import purchase as purchase_router
from backend.routers import ucp as ucp_router
from backend.config.llm import resolve_llm
from backend.observability.tracing import init_tracing
from backend.mcp.server import mcp as mcp_server

DB_PATH = Path(__file__).parent / "db" / "commerce.db"

# Real MCP transport: mounted as an ASGI sub-app so the 7 commerce tools are
# actually served over Streamable HTTP, not just imported as Python functions.
# stateless_http=True — each tool call is independent, no session continuity
# needed for this demo's short-lived search/price/inventory lookups.
mcp_asgi_app = mcp_server.http_app(path="/", stateless_http=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncExitStack() as stack:
        await stack.enter_async_context(mcp_asgi_app.lifespan(app))
        init_db(DB_PATH)
        seed_db()
        llm_info = resolve_llm()
        print(f"[LLM] Using {llm_info['provider']} / {llm_info['model']}")
        tracing_enabled, endpoint = init_tracing()
        print(f"[Observability] Tracing {'enabled -> ' + endpoint if tracing_enabled else 'disabled'}")
        yield


app = FastAPI(
    title="Agentic Commerce POC",
    description="Multi-agent commerce demo with DPAT payment authorization",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(merchants.router)
app.include_router(products.router)
app.include_router(chat.router)
app.include_router(authorizations.router)
app.include_router(payments.router)
app.include_router(cart.router)
app.include_router(compare.router)
app.include_router(loyalty.router)
app.include_router(a2a_router.router)
app.include_router(generic_chat_router.router)
app.include_router(purchase_router.router)
app.include_router(ucp_router.router)
app.mount("/mcp", mcp_asgi_app)  # real MCP Streamable HTTP transport (see mcp_asgi_app above)


@app.get("/")
def health():
    return {"status": "ok", "service": "Agentic Commerce POC"}


@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """
    Voice input endpoint. Accepts an audio file (webm/wav) and returns
    the transcript using faster-whisper (local, no API key needed).
    Wired to the mic button in the Chat UI.
    Full implementation in Phase 2 — returns placeholder in Phase 1.
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="faster-whisper not installed. Run: pip install faster-whisper"
        )

    audio_bytes = await audio.read()
    tmp_path = Path(tempfile.gettempdir()) / audio.filename
    tmp_path.write_bytes(audio_bytes)

    model = WhisperModel("base", device="cpu", compute_type="int8")
    segments, _ = model.transcribe(str(tmp_path), beam_size=5)
    transcript = " ".join(seg.text.strip() for seg in segments)

    tmp_path.unlink(missing_ok=True)
    return {"text": transcript}
