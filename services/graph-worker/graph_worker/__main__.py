"""Graph worker: document.parse and graph.build work items."""

from __future__ import annotations

import json
from typing import Any

from crowdlens_worker import (
    ProviderClient,
    WorkClaim,
    WorkerConfig,
    WorkerDb,
    claim_loop,
    load_config,
    open_storage,
)

from .extract import extract_chunk, serialize_extractions
from .parser import parse_document


def handle_document_parse(claim: WorkClaim, db: WorkerDb, storage: Any, config: WorkerConfig) -> None:
    document_id = claim.payload["document_id"]
    sha256 = claim.payload["sha256"]
    with db.tenant_tx(claim.workspace_id) as conn:
        doc = conn.execute(
            "SELECT id, filename, mime_type, object_key, parser_version, project_id FROM documents WHERE id = %s",
            (document_id,),
        ).fetchone()
        if not doc:
            raise RuntimeError(f"document {document_id} not found")
    body = storage.get(doc["object_key"])
    parsed = parse_document(doc["mime_type"], body)
    artifact_key = f"tenant/{claim.workspace_id}/parsed/{sha256}.{doc['parser_version']}.json"
    if parsed.error:
        with db.tenant_tx(claim.workspace_id) as conn:
            conn.execute(
                "UPDATE documents SET parse_status = 'failed' WHERE workspace_id = %s AND id = %s",
                (claim.workspace_id, document_id),
            )
        raise RuntimeError(f"parse failed for {doc['filename']}: {parsed.error}")
    artifact = {
        "sha256": sha256,
        "parser_version": doc["parser_version"],
        "filename": doc["filename"],
        "chunks": [
            {"chunk_id": c.chunk_id, "locator": c.locator, "text": c.text, "source_hash": sha256}
            for c in parsed.chunks
        ],
    }
    # Content-addressed parse artifact: identical content reuses this object.
    if not storage.exists(artifact_key):
        storage.put(artifact_key, json.dumps(artifact).encode())
    with db.tenant_tx(claim.workspace_id) as conn:
        conn.execute(
            "UPDATE documents SET parse_status = 'parsed', parse_artifact_key = %s WHERE workspace_id = %s AND id = %s",
            (artifact_key, claim.workspace_id, document_id),
        )


def handle_graph_build(claim: WorkClaim, db: WorkerDb, storage: Any, config: WorkerConfig) -> None:
    graph_id = claim.payload["graph_id"]
    project_id = claim.payload["project_id"]
    with db.tenant_tx(claim.workspace_id) as conn:
        graph = conn.execute(
            "SELECT id, embedding_profile FROM graphs WHERE id = %s", (graph_id,)
        ).fetchone()
        docs = conn.execute(
            "SELECT id, sha256, parse_artifact_key FROM documents WHERE project_id = %s AND parse_status = 'parsed'",
            (project_id,),
        ).fetchall()
    if not graph:
        raise RuntimeError(f"graph {graph_id} not found")

    manifest = None
    provider = "mock"
    model_id = "mock-sim-1"
    with db.tenant_tx(claim.workspace_id) as conn:
        sim = conn.execute(
            "SELECT manifest FROM simulations WHERE project_id = %s ORDER BY created_at DESC LIMIT 1",
            (project_id,),
        ).fetchone()
        if sim and sim.get("manifest"):
            manifest = sim["manifest"]
            provider = manifest.get("provider", "mock")
            model_id = manifest.get("model_id", "mock-sim-1")

    provider_client = ProviderClient(
        gemini_key=config.gemini_api_key,
        openrouter_key=config.openrouter_api_key,
        app_url=config.openrouter_app_url,
        app_name=config.openrouter_app_name,
    )

    all_chunks: list[dict[str, Any]] = []
    for doc in docs:
        artifact = json.loads(storage.get(doc["parse_artifact_key"]).decode())
        all_chunks.extend(artifact["chunks"])

    extractions = []
    for chunk in all_chunks:
        extraction, usage = extract_chunk(
            provider_client,
            claim.workspace_id,
            0,
            chunk["chunk_id"],
            chunk["text"],
            provider,
            model_id,
        )
        extractions.append(extraction)
        # Durable usage record (idempotent per chunk + attempt semantics).
        with db.tenant_tx(claim.workspace_id) as conn:
            conn.execute(
                """INSERT INTO usage_records
                   (workspace_id, simulation_id, activity_attempt, usage_type, provider, model_id,
                    input_tokens, output_tokens, cached_input_tokens, latency_ms)
                   VALUES (%s, %s, %s, 'graph_chunk', %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (simulation_id, activity_attempt, usage_type) DO NOTHING""",
                (
                    claim.workspace_id,
                    graph_id,
                    f"graph-{graph_id}-chunk-{chunk['chunk_id']}",
                    provider,
                    model_id,
                    usage["input_tokens"],
                    usage["output_tokens"],
                    usage["cached_input_tokens"],
                    usage["latency_ms"],
                ),
            )

    graph_artifact = serialize_extractions(extractions)
    artifact_key = f"tenant/{claim.workspace_id}/graphs/{graph_id}.json"
    storage.put(artifact_key, graph_artifact.encode())

    # Populate graph_nodes / graph_edges behind the GraphStorage port.
    with db.tenant_tx(claim.workspace_id) as conn:
        conn.execute("DELETE FROM graph_edges WHERE workspace_id = %s AND graph_id = %s", (claim.workspace_id, graph_id))
        conn.execute("DELETE FROM graph_nodes WHERE workspace_id = %s AND graph_id = %s", (claim.workspace_id, graph_id))
        node_ids: dict[str, str] = {}
        edge_count = 0
        theme_nodes: dict[str, str] = {}
        for extraction in extractions:
            for entity in extraction.entities:
                name_key = f"{entity.kind}:{entity.name.lower()}"
                if name_key not in node_ids:
                    node_id = f"n{len(node_ids)}"
                    node_ids[name_key] = node_id
                    conn.execute(
                        """INSERT INTO graph_nodes (workspace_id, graph_id, node_id, kind, name, attrs)
                           VALUES (%s, %s, %s, %s, %s, %s)""",
                        (claim.workspace_id, graph_id, node_id, entity.kind, entity.name, json.dumps({"first_chunk": extraction.chunk_id})),
                    )
                for theme in extraction.themes:
                    theme_key = f"theme:{theme.label.lower()}"
                    if theme_key not in theme_nodes:
                        theme_id = f"t{len(theme_nodes)}"
                        theme_nodes[theme_key] = theme_id
                        conn.execute(
                            """INSERT INTO graph_nodes (workspace_id, graph_id, node_id, kind, name, attrs)
                               VALUES (%s, %s, %s, 'theme', %s, %s)""",
                            (claim.workspace_id, graph_id, theme_id, theme.label, json.dumps({"sentiment": theme.sentiment})),
                        )
                    conn.execute(
                        """INSERT INTO graph_edges (workspace_id, graph_id, src, dst, kind, attrs)
                           VALUES (%s, %s, %s, %s, 'discussed', %s)""",
                        (claim.workspace_id, graph_id, node_ids[name_key], theme_nodes[theme_key], json.dumps({"chunk": extraction.chunk_id})),
                    )
                    edge_count += 1
        conn.execute(
            """UPDATE graphs SET status = 'ready', node_count = %s, edge_count = %s, artifact_key = %s
               WHERE workspace_id = %s AND id = %s""",
            (len(node_ids) + len(theme_nodes), edge_count, artifact_key, claim.workspace_id, graph_id),
        )
        # Bump the graph cache generation (same tx): cached graph searches
        # keyed at the previous generation stop being readable (arch §12.6).
        conn.execute(
            """INSERT INTO cache_versions (workspace_id, scope, version) VALUES (%s, 'graph', 1)
               ON CONFLICT (workspace_id, scope) DO UPDATE
                 SET version = cache_versions.version + 1, updated_at = now()""",
            (claim.workspace_id,),
        )
        conn.execute(
            "UPDATE projects SET stage = 'world', version = version + 1, updated_at = now() WHERE workspace_id = %s AND id = %s",
            (claim.workspace_id, project_id),
        )


def main(once: bool = False) -> None:
    config = load_config()
    db = WorkerDb(config.app_database_url, config.database_url)
    storage = open_storage(config)

    def handler(claim: WorkClaim) -> None:
        if claim.kind == "document.parse":
            handle_document_parse(claim, db, storage, config)
        elif claim.kind == "graph.build":
            handle_graph_build(claim, db, storage, config)
        else:
            raise RuntimeError(f"unexpected work kind {claim.kind}")

    claim_loop(db, ["document.parse", "graph.build"], handler, once=once)


if __name__ == "__main__":
    main()
