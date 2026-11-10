"""Worker configuration — resolved once at startup (instructions.md §5.1)."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class WorkerConfig:
    database_url: str
    app_database_url: str  # crowdlens_app role (RLS-enforced)
    storage_fs_dir: str
    s3_endpoint: str
    s3_region: str
    s3_bucket: str
    s3_access_key: str
    s3_secret_key: str
    gemini_api_key: str
    openrouter_api_key: str
    openrouter_app_url: str
    openrouter_app_name: str
    control_api_origin: str

    @property
    def uses_s3(self) -> bool:
        return bool(self.s3_endpoint)


def load_config(env: dict[str, str] | None = None) -> WorkerConfig:
    e = env or os.environ
    embedded = e.get("EMBEDDED_PG_DATA_DIR", "")
    if embedded:
        port = e.get("EMBEDDED_PG_PORT", "55432")
        database_url = f"postgres://postgres:postgres@localhost:{port}/crowdlens"
        app_database_url = f"postgres://crowdlens_app:crowdlens_app_dev@localhost:{port}/crowdlens"
    else:
        database_url = e.get("DATABASE_URL", "postgres://crowdlens:crowdlens@localhost:5432/crowdlens")
        app_database_url = database_url
    return WorkerConfig(
        database_url=database_url,
        app_database_url=app_database_url,
        storage_fs_dir=e.get("STORAGE_FS_DIR", ".data/objects"),
        s3_endpoint=e.get("S3_ENDPOINT", ""),
        s3_region=e.get("S3_REGION", "us-east-1"),
        s3_bucket=e.get("S3_BUCKET", "crowdlens-artifacts"),
        s3_access_key=e.get("S3_ACCESS_KEY_REFERENCE", ""),
        s3_secret_key=e.get("S3_SECRET_KEY_REFERENCE", ""),
        gemini_api_key=e.get("GEMINI_API_KEY_REFERENCE", ""),
        openrouter_api_key=e.get("OPENROUTER_API_KEY_REFERENCE", ""),
        openrouter_app_url=e.get("OPENROUTER_APP_URL", "http://localhost:3000"),
        openrouter_app_name=e.get("OPENROUTER_APP_NAME", "CrowdLens"),
        control_api_origin=e.get("CONTROL_API_ORIGIN", "http://localhost:4000"),
    )
