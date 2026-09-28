from dataclasses import dataclass


@dataclass(frozen=True)
class AgentConfig:
    agent_id: str
    display_name: str
    role: str
    description: str
    trust_status: str = "trusted"


VIBECHECK = AgentConfig(
    agent_id="VIBECHECK_001",
    display_name="VibeCheck",
    role="orchestrator",
    description="Understands what the user actually wants — extracts structured shopping intent and coordinates all other agents.",
)

SNEAKPEEK = AgentConfig(
    agent_id="SNEAKPEEK_001",
    display_name="SneakPeek",
    role="product_search",
    description="Searches products across all merchant sources via MCP and brings back the best-matching options.",
)

CARTUP = AgentConfig(
    agent_id="CARTUP_001",
    display_name="CartUp",
    role="merchant_seller",
    description="Checks inventory, verifies pricing, calculates shipping and tax, and builds the checkout quote.",
)

GREENLIGHT = AgentConfig(
    agent_id="GREENLIGHT_001",
    display_name="GreenLight",
    role="payment_authorization",
    description="Confirms user approval, applies policy guardrails, and issues the scoped DPAT token.",
)

PAYIT = AgentConfig(
    agent_id="PAYIT_001",
    display_name="PayIt",
    role="payment_execution",
    description="Validates the DPAT token through 12 deterministic checks and submits the authorized payment.",
)

TRACKIT = AgentConfig(
    agent_id="TRACKIT_001",
    display_name="TrackIt",
    role="order_management",
    description="Confirms the order, updates the dashboard, and writes the full audit trail.",
)

# Ordered roster — matches the flow sequence
ALL_AGENTS: list[AgentConfig] = [
    VIBECHECK,
    SNEAKPEEK,
    CARTUP,
    GREENLIGHT,
    PAYIT,
    TRACKIT,
]

AGENT_BY_ID: dict[str, AgentConfig] = {a.agent_id: a for a in ALL_AGENTS}
AGENT_BY_ROLE: dict[str, AgentConfig] = {a.role: a for a in ALL_AGENTS}
