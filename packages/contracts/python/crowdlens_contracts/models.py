"""Pydantic mirror of packages/contracts/src/types.ts.

Both sides are pinned to the same JSON Schema sources and golden fixtures.
Domain code validates LLM/provider payloads with these models at boundaries
(instructions.md §3.3: JSON Schema plus local validation).
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

ProviderId = Literal["gemini", "openrouter", "mock"]
Role = Literal["owner", "admin", "analyst", "viewer", "billing_admin"]
SimulationStatus = Literal[
    "draft", "queued", "preparing", "running", "finalizing",
    "completed", "paused", "failed", "cancelled",
]
LedgerEntryType = Literal[
    "plan_grant", "topup_grant", "reservation", "reservation_release",
    "usage_debit", "adjustment", "expiration",
]

LEGAL_RUN_TRANSITIONS: dict[SimulationStatus, tuple[SimulationStatus, ...]] = {
    "draft": ("queued",),
    "queued": ("preparing", "cancelled", "failed"),
    "preparing": ("running", "cancelled", "failed"),
    "running": ("finalizing", "paused", "cancelled", "failed"),
    "paused": ("running", "cancelled", "failed"),
    "finalizing": ("completed", "failed"),
    "completed": (),
    "failed": (),
    "cancelled": (),
}


def assert_legal_transition(frm: SimulationStatus, to: SimulationStatus) -> None:
    if to not in LEGAL_RUN_TRANSITIONS[frm]:
        raise ValueError(f"illegal simulation transition: {frm} -> {to}")


class RunManifest(BaseModel):
    model_config = ConfigDict(frozen=True)
    schema_version: Literal[1] = 1
    provider: ProviderId
    model_id: str = Field(min_length=1)
    model_revision: str = Field(min_length=1)
    prompt_bundle_version: str = Field(min_length=1)
    structured_schema_version: str = Field(min_length=1)
    embedding_profile_id: str = Field(min_length=1)
    routing_policy: dict = Field(default_factory=dict)
    random_seed: int
    rate_card_version: str = Field(min_length=1)


class SimulationConfig(BaseModel):
    project_id: UUID
    decision_question: str = Field(min_length=8, max_length=2000)
    target_audience: str | None = Field(default=None, max_length=1000)
    platforms: list[str] = Field(default_factory=list, max_length=16)
    assumptions: str | None = Field(default=None, max_length=4000)
    population: int = Field(ge=100, le=1_000_000)
    active_budget: int = Field(default=256, ge=16, le=100_000)
    reasoning_depth: Literal["standard", "deep"] = "standard"
    ticks: int = Field(default=24, ge=1, le=200)
    seed_policy: Literal["random", "fixed"] = "random"
    seed: int | None = None
    provider: ProviderId | None = None
    model_id: str | None = None
    report_depth: Literal["standard", "detailed"] = "standard"


class SimulationEstimate(BaseModel):
    rate_card_version: str
    credits_low: int = Field(ge=0)
    credits_high: int = Field(ge=0)
    hard_cap: int = Field(ge=1)
    drivers: list[dict] = Field(default_factory=list)


class DataPolicy(BaseModel):
    data_collection: Literal["allow", "deny"] = "deny"
    zdr: bool = False


class StructuredGenerationRequest(BaseModel):
    provider: ProviderId
    model_id: str = Field(min_length=1)
    prompt_prefix: str
    prompt_suffix: str
    json_schema: dict
    schema_version: str = Field(min_length=1)
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_output_tokens: int = Field(default=2048, ge=1)
    session_id: str | None = None
    data_policy: DataPolicy | None = None


class TokenUsage(BaseModel):
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    cached_input_tokens: int = Field(default=0, ge=0)
    cost_estimate_micro_usd: int | None = None
    usage_is_estimate: bool = False


class StructuredGenerationResult(BaseModel):
    data: object
    provider: ProviderId
    model_id: str
    endpoint: str | None = None
    request_id: str | None = None
    latency_ms: int = Field(ge=0)
    retries: int = Field(default=0, ge=0)
    usage: TokenUsage
    cache_metadata: dict | None = None
    raw_artifact_ref: str | None = None


class EventEnvelope(BaseModel):
    event_id: UUID
    event_type: str = Field(pattern=r"^[a-z]+(\.[a-z_]+)+$")
    event_version: int = Field(ge=1)
    occurred_at: datetime
    workspace_id: UUID
    aggregate_id: str = Field(min_length=1)
    correlation_id: str | None = None
    causation_id: str | None = None
    payload: dict = Field(default_factory=dict)


class LedgerEntry(BaseModel):
    workspace_id: UUID
    entry_type: LedgerEntryType
    amount: int
    idempotency_key: str = Field(min_length=8, max_length=200)
    rate_card_version: str
    actor: str | None = None
    event_ref: str | None = None
    simulation_id: str | None = None
    reason: str | None = None
    occurred_at: datetime


class ProvenanceItem(BaseModel):
    type: Literal["source_chunk", "event_aggregate", "active_agent_response", "model_inference"]
    id: str = Field(min_length=1)
    relation: Literal["context", "supports", "contradicts", "example"]


class ReportClaim(BaseModel):
    claim_id: str = Field(min_length=1)
    text: str = Field(min_length=1)
    confidence_label: Literal["exploratory", "supported", "contradicted"]
    evidence: list[ProvenanceItem]
    method: Literal[
        "llm_generated_synthesis",
        "source_backed_extraction",
        "aggregate_simulation",
        "surrogate_inferred",
    ]
