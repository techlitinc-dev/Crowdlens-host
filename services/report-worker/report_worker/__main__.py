"""Report worker: evidence-linked report assembly + provenance-labelled interviews."""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from crowdlens_contracts import StructuredGenerationRequest
from crowdlens_worker import (
    ProviderClient,
    WorkClaim,
    WorkerConfig,
    WorkerDb,
    claim_loop,
    load_config,
    open_storage,
)
from pydantic import BaseModel

DISCLAIMER = (
    "This is a synthetic scenario analysis generated from source documents and simulated "
    "agents. It is not a representative survey, a factual forecast, or a substitute for "
    "human review and real-world validation."
)


class InterviewOutput(BaseModel):
    answer: str
    confidence: str = "exploratory"
    memory_refs: list[str] = []


INTERVIEW_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["answer"],
    "properties": {
        "answer": {"type": "string"},
        "confidence": {"type": "string", "enum": ["exploratory", "supported"]},
        "memory_refs": {"type": "array", "items": {"type": "string"}},
    },
}


def run_prefix(workspace_id: str, simulation_id: str) -> str:
    return f"tenant/{workspace_id}/runs/{simulation_id}"


def handle_report(claim: WorkClaim, db: WorkerDb, storage: Any) -> None:
    simulation_id = claim.payload["simulation_id"]
    workspace_id = claim.workspace_id

    with db.tenant_tx(workspace_id) as conn:
        sim = conn.execute(
            "SELECT config, manifest, seed, status FROM simulations WHERE id = %s", (simulation_id,)
        ).fetchone()
    if not sim:
        raise RuntimeError(f"simulation {simulation_id} not found")
    config = sim["config"]
    manifest = sim["manifest"]
    ticks = int(config.get("ticks", 24))

    with db.tenant_tx(workspace_id) as conn:
        shards = conn.execute(
            "SELECT shard_index FROM simulation_shards WHERE simulation_id = %s ORDER BY shard_index",
            (simulation_id,),
        ).fetchall()
        docs = conn.execute(
            """SELECT d.id, d.parse_artifact_key FROM documents d
               WHERE d.workspace_id = %s AND d.project_id = %s AND d.parse_status = 'parsed'""",
            (workspace_id, config.get("project_id")),
        ).fetchall()
        latest_version = conn.execute(
            "SELECT COALESCE(MAX(version), 0) AS version FROM reports WHERE simulation_id = %s",
            (simulation_id,),
        ).fetchone()["version"]

    # Aggregate per-tick, per-segment series across shards.
    segment_series: dict[str, dict[str, list[float]]] = {}
    objections: list[dict[str, Any]] = []
    sample_events: list[dict[str, Any]] = []
    active_ratio_numer = 0
    active_ratio_denom = 0
    for shard in [s["shard_index"] for s in shards]:
        for tick in range(1, ticks + 1):
            agg_key = f"{run_prefix(workspace_id, simulation_id)}/shards/{shard}/aggregates-{tick}.json"
            if not storage.exists(agg_key):
                continue
            aggregates = json.loads(storage.get(agg_key).decode())
            for segment, stats in aggregates.items():
                series = segment_series.setdefault(segment, {"stance_mean": [], "support_share": [], "activity_mean": []})
                series["stance_mean"].append(stats["stance_mean"])
                series["support_share"].append(stats["support_share"])
                series["activity_mean"].append(stats["activity_mean"])
                active_ratio_numer += stats.get("direct_agents", 0)
                active_ratio_denom += stats.get("agents", 0)
                if stats["stance_mean"] < -0.05:
                    objections.append(
                        {
                            "segment": segment,
                            "tick": tick,
                            "stance_mean": stats["stance_mean"],
                            "evidence": {"type": "event_aggregate", "id": f"{simulation_id}/{tick}/{shard}/{segment}", "relation": "supports"},
                        }
                    )
        events_key = f"{run_prefix(workspace_id, simulation_id)}/shards/{shard}/events-{ticks}.json"
        if storage.exists(events_key):
            for event in json.loads(storage.get(events_key).decode())[:20]:
                if event.get("type") == "direct_action":
                    sample_events.append(event)

    source_chunks: list[dict[str, str]] = []
    for doc in docs:
        if doc.get("parse_artifact_key") and storage.exists(doc["parse_artifact_key"]):
            artifact = json.loads(storage.get(doc["parse_artifact_key"]).decode())
            source_chunks.extend(
                {"id": c["chunk_id"], "text": c["text"][:300]} for c in artifact.get("chunks", [])[:8]
            )

    segments = []
    for name, series in sorted(segment_series.items()):
        final_stance = series["stance_mean"][-1] if series["stance_mean"] else 0.0
        initial_stance = series["stance_mean"][0] if series["stance_mean"] else 0.0
        segments.append(
            {
                "name": name,
                "stance": "supportive" if final_stance > 0.1 else "opposed" if final_stance < -0.1 else "divided",
                "stance_mean": round(final_stance, 3),
                "stance_delta": round(final_stance - initial_stance, 3),
                "support_share": round(series["support_share"][-1] if series["support_share"] else 0, 3),
                "share": round(1 / max(1, len(segment_series)), 3),
                "sample_size_note": "synthetic population; not a survey sample",
                "provenance": "aggregate_simulation",
            }
        )

    active_ratio = round(active_ratio_numer / active_ratio_denom, 4) if active_ratio_denom else 0.0
    biggest_objector = min(segments, key=lambda s: s["stance_mean"], default=None)
    summary_text = (
        (
            f"Across {len(segment_series)} segments and {ticks} ticks, the population settled into "
            f"{'broadly supportive' if (segments and sum(s['stance_mean'] for s in segments) / len(segments) > 0) else 'mixed or opposed'} "
            f"territory. "
            + (f"{biggest_objector['name']} remained the strongest objection source. " if biggest_objector else "")
            + "Active direct reasoning covered a bounded, stratified subset; cohort rules propagated effects to the full population."
        )
        if segments
        else "Insufficient simulation output to summarise."
    )

    report = {
        "report_version": latest_version + 1,
        "simulation_id": simulation_id,
        "decision_question": config.get("decision_question", ""),
        "summary": summary_text,
        "segments": segments,
        "timeline": {
            "ticks": ticks,
            "series": {name: series["stance_mean"] for name, series in segment_series.items()},
        },
        "narratives": [
            {
                "claim_id": f"clm_{uuid.uuid4().hex[:10]}",
                "text": f"The most persistent objection theme concentrates in {biggest_objector['name']}." if biggest_objector else "No dominant objection theme.",
                "confidence_label": "exploratory",
                "evidence": [
                    {"type": "event_aggregate", "id": f"{simulation_id}/last/{biggest_objector['name'] if biggest_objector else 'none'}", "relation": "supports"}
                ],
                "method": "aggregate_simulation",
            }
        ],
        "objections": objections[:20],
        "opportunities": [
            {
                "claim_id": f"clm_{uuid.uuid4().hex[:10]}",
                "text": f"{s['name']} shows movement potential (delta {s['stance_delta']:+.2f}).",
                "confidence_label": "exploratory",
                "evidence": [{"type": "event_aggregate", "id": f"{simulation_id}/delta/{s['name']}", "relation": "supports"}],
                "method": "aggregate_simulation",
            }
            for s in segments
            if abs(s["stance_delta"]) >= 0.05
        ][:10],
        "risks": [
            {
                "claim_id": f"clm_{uuid.uuid4().hex[:10]}",
                "text": "Single-seed synthetic trajectories can overstate confidence.",
                "confidence_label": "supported",
                "evidence": [{"type": "model_inference", "id": "method/limits", "relation": "context"}],
                "method": "llm_generated_synthesis",
            }
        ],
        "method": {
            "provider": manifest.get("provider"),
            "model_id": manifest.get("model_id"),
            "model_revision": manifest.get("model_revision"),
            "prompt_bundle_version": manifest.get("prompt_bundle_version"),
            "random_seed": manifest.get("random_seed"),
            "population": config.get("population"),
            "ticks": ticks,
            "active_surrogate_ratio": active_ratio,
            "rate_card_version": manifest.get("rate_card_version"),
            "embedding_profile_id": manifest.get("embedding_profile_id"),
        },
        "limitations": [
            "Synthetic agents do not represent real individuals or a statistical population.",
            "Results are scenario exploration, not prediction; validate with real research.",
            f"Direct LLM reasoning covered {active_ratio:.1%} of agent-ticks; the rest are cohort-inferred.",
        ],
        "sample_agent_events": sample_events[:12],
        "source_chunks": source_chunks[:8],
        "disclaimer": DISCLAIMER,
    }

    body = json.dumps(report, indent=2).encode()
    content_hash = hashlib.sha256(body).hexdigest()
    object_key = f"{run_prefix(workspace_id, simulation_id)}/reports/v{latest_version + 1}/report.json"
    storage.put(object_key, body)
    evidence_manifest = [e for n in report["narratives"] for e in n["evidence"]]

    with db.tenant_tx(workspace_id) as conn:
        conn.execute(
            """INSERT INTO reports (workspace_id, id, simulation_id, version, content_hash, object_key, evidence_manifest)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (workspace_id, str(uuid.uuid4()), simulation_id, latest_version + 1, content_hash, object_key, json.dumps(evidence_manifest)),
        )
        conn.execute(
            """INSERT INTO simulation_events (workspace_id, simulation_id, type, payload, authz_epoch)
               VALUES (%s, %s, 'report_ready', %s, 1)""",
            (workspace_id, simulation_id, json.dumps({"version": latest_version + 1, "content_hash": content_hash})),
        )


def handle_interview(claim: WorkClaim, db: WorkerDb, storage: Any, config: WorkerConfig) -> None:
    interview_id = claim.payload["interview_id"]
    report_id = claim.payload["report_id"]
    simulation_id = claim.payload["simulation_id"]
    agent_ref = claim.payload["agent_ref"]
    question = claim.payload["question"]
    workspace_id = claim.workspace_id

    with db.tenant_tx(workspace_id) as conn:
        sim = conn.execute("SELECT manifest, config FROM simulations WHERE id = %s", (simulation_id,)).fetchone()
        report = conn.execute("SELECT object_key FROM reports WHERE id = %s", (report_id,)).fetchone()
    if not sim or not report:
        raise RuntimeError("report or simulation missing for interview")

    manifest = sim["manifest"]
    report_json = json.loads(storage.get(report["object_key"]).decode())
    agent_events = [
        event
        for event in report_json.get("sample_agent_events", [])
        if str(event.get("agent")) in agent_ref or agent_ref.endswith(str(event.get("agent")))
    ][:5]
    context = "\n".join(f"- {e.get('message', '')}" for e in agent_events) or "(no direct memory available for this agent)"

    provider_client = ProviderClient(
        gemini_key=config.gemini_api_key,
        openrouter_key=config.openrouter_api_key,
        app_url=config.openrouter_app_url,
        app_name=config.openrouter_app_name,
    )
    provider: str = manifest.get("provider", "mock")
    model_id: str = manifest.get("model_id", "mock-sim-1")
    request = StructuredGenerationRequest(
        provider=provider,  # type: ignore[arg-type]
        model_id=model_id,
        prompt_prefix=(
            "You answer as a simulated audience agent in a scenario analysis. "
            "Always disclose that you are a synthetic agent. Ground the answer in the "
            "agent's visible history. Respond with JSON only."
        ),
        prompt_suffix=(
            f"Agent: {agent_ref}\nVisible history:\n{context}\n\n"
            f"Interview question: {question}\n"
            f"Decision context: {report_json.get('decision_question', '')}"
        ),
        json_schema=INTERVIEW_SCHEMA,
        schema_version="interview-v1",
        temperature=0.5,
        session_id=f"interview-{interview_id}",
    )
    try:
        result = provider_client.generate_structured(request, InterviewOutput)
    except Exception as error:  # noqa: BLE001
        with db.tenant_tx(workspace_id) as conn:
            conn.execute(
                "UPDATE interviews SET status = 'failed', error = %s, completed_at = now() WHERE workspace_id = %s AND id = %s",
                (str(error)[:500], workspace_id, interview_id),
            )
        return

    response = {
        **result.data,
        "agent_ref": agent_ref,
        "provenance": "llm_generated",
        "agent_type": "direct_reasoning" if agent_events else "surrogate_inferred_no_direct_memory",
        "provider": provider,
        "model_id": model_id,
    }
    with db.tenant_tx(workspace_id) as conn:
        conn.execute(
            """UPDATE interviews SET status = 'ready', response = %s, completed_at = now(),
                   provenance = 'llm_generated'
               WHERE workspace_id = %s AND id = %s""",
            (json.dumps(response), workspace_id, interview_id),
        )
        conn.execute(
            """INSERT INTO usage_records
               (workspace_id, simulation_id, activity_attempt, usage_type, provider, model_id,
                input_tokens, output_tokens, cached_input_tokens, latency_ms)
               VALUES (%s, %s, %s, 'active_reasoning', %s, %s, %s, %s, %s, %s)
               ON CONFLICT (simulation_id, activity_attempt, usage_type) DO NOTHING""",
            (
                workspace_id,
                simulation_id,
                f"interview-{interview_id}",
                provider,
                model_id,
                result.usage.input_tokens,
                result.usage.output_tokens,
                result.usage.cached_input_tokens,
                result.latency_ms,
            ),
        )


def main(once: bool = False) -> None:
    config = load_config()
    db = WorkerDb(config.app_database_url, config.database_url)
    storage = open_storage(config)

    def handler(claim: WorkClaim) -> None:
        subtype = claim.payload.get("subtype")
        if subtype == "interview":
            handle_interview(claim, db, storage, config)
        elif subtype == "report":
            handle_report(claim, db, storage)
        else:
            raise RuntimeError(f"unknown report subtype {subtype}")

    claim_loop(db, ["report.generate"], handler, once=once)


if __name__ == "__main__":
    main()
