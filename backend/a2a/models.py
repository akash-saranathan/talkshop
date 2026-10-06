"""
A2A protocol models — Agent Card, Task, Artifact shapes.
Follows the real A2A spec (a2a-protocol.org) using JSON-RPC 2.0.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Literal
from pydantic import BaseModel, Field


# ── Agent Card ──────────────────────────────────────────────────────────────

class AgentSkill(BaseModel):
    id: str
    name: str
    description: str
    inputModes: list[str] = ["text"]
    outputModes: list[str] = ["text", "data"]


class AgentCapabilities(BaseModel):
    streaming: bool = True
    pushNotifications: bool = False
    stateTransitionHistory: bool = False


class AgentCard(BaseModel):
    name: str
    description: str
    url: str
    version: str = "1.0"
    capabilities: AgentCapabilities = Field(default_factory=AgentCapabilities)
    skills: list[AgentSkill] = []


# ── Task / Message parts ─────────────────────────────────────────────────────

class TextPart(BaseModel):
    type: Literal["text"] = "text"
    text: str


class DataPart(BaseModel):
    type: Literal["data"] = "data"
    data: dict[str, Any]


Part = TextPart | DataPart


class A2AMessage(BaseModel):
    role: Literal["user", "agent"] = "user"
    messageId: str
    contextId: str
    parts: list[Part]


# ── Task status / result ─────────────────────────────────────────────────────

class TaskStatus(BaseModel):
    state: Literal["submitted", "working", "completed", "failed"] = "completed"
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    message: str | None = None


class Artifact(BaseModel):
    artifactId: str
    name: str
    parts: list[Part]


class TaskResult(BaseModel):
    id: str
    contextId: str
    status: TaskStatus
    artifacts: list[Artifact] = []


# ── JSON-RPC 2.0 envelope ────────────────────────────────────────────────────

class A2ARequest(BaseModel):
    jsonrpc: Literal["2.0"] = "2.0"
    method: str
    id: str
    params: dict[str, Any]


class A2AResponse(BaseModel):
    jsonrpc: Literal["2.0"] = "2.0"
    id: str
    result: TaskResult | None = None
    error: dict[str, Any] | None = None


# ── Shopping-specific intent passed between layers ───────────────────────────

class ShoppingIntent(BaseModel):
    raw_query: str
    brand: str | None = None
    category: str | None = None
    subcategory: str | None = None
    max_price: float | None = None
    size: str | None = None
    color: str | None = None
    keywords: list[str] = []
