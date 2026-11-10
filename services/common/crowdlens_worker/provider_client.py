"""Provider gateway client for workers (specs.md §8, architecture.md §10).

Structured generation: JSON Schema in, local Pydantic validation of parsed
output, normalised usage evidence. Mirrors the TS ProviderGateway contract.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
from crowdlens_contracts import (
    StructuredGenerationRequest,
    TokenUsage,
)
from pydantic import BaseModel, ValidationError


class ProviderCallError(Exception):
    def __init__(self, code: str, message: str, retryable: bool) -> None:
        super().__init__(f"[{code}] {message}")
        self.code = code
        self.retryable = retryable


@dataclass
class ProviderResult:
    data: dict[str, Any]
    usage: TokenUsage
    request_id: str
    latency_ms: int
    endpoint: str = ""
    cache_metadata: dict[str, Any] = field(default_factory=dict)


class PersonaOutput(BaseModel):
    """Example structured output schema used by the mock provider."""

    model_config = {"extra": "allow"}


def synthesize_from_schema(schema: dict[str, Any], seed: int) -> Any:
    """Deterministic schema-shaped synthesis (mirrors the TS mock provider)."""
    rng_state = seed & 0xFFFFFFFF

    def next_rand() -> float:
        nonlocal rng_state
        rng_state = (rng_state + 0x6D2B79F5) & 0xFFFFFFFF
        t = (rng_state ^ (rng_state >> 15)) * (1 | rng_state)
        t = (t + ((t ^ (t >> 7)) * (61 | t))) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    def resolve(node: dict[str, Any]) -> Any:
        if "const" in node:
            return node["const"]
        if "enum" in node and isinstance(node["enum"], list) and node["enum"]:
            return node["enum"][int(next_rand() * len(node["enum"])) % len(node["enum"])]
        node_type = node.get("type")
        if node_type == "string":
            if node.get("format") == "date-time":
                return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(1_700_000_000 + int(next_rand() * 100_000_000)))
            return f"mock-{int(next_rand() * 1e6):x}"
        if node_type == "integer":
            return int(next_rand() * 100)
        if node_type == "number":
            return round(next_rand() * 1000, 1)
        if node_type == "boolean":
            return next_rand() > 0.5
        if node_type == "array":
            item = node.get("items") or {"type": "string"}
            return [resolve(item) for _ in range(max(1, int(next_rand() * 3)))]
        props = node.get("properties") or {}
        required = set(node.get("required") or props.keys())
        return {k: resolve(v) for k, v in props.items() if k in required}

    return resolve(schema)


class ProviderClient:
    def __init__(self, gemini_key: str = "", openrouter_key: str = "", app_url: str = "", app_name: str = "CrowdLens") -> None:
        self.gemini_key = gemini_key
        self.openrouter_key = openrouter_key
        self.app_url = app_url
        self.app_name = app_name
        self._http = httpx.Client(timeout=30.0)

    def generate_structured(self, request: StructuredGenerationRequest, validate_with: type[BaseModel]) -> ProviderResult:
        if request.provider == "mock":
            return self._mock(request, validate_with)
        if request.provider == "gemini":
            return self._gemini(request, validate_with)
        if request.provider == "openrouter":
            return self._openrouter(request, validate_with)
        raise ProviderCallError("unknown_provider", f"unknown provider {request.provider}", False)

    def _validate(self, data: Any, validate_with: type[BaseModel]) -> dict[str, Any]:
        try:
            return validate_with.model_validate(data).model_dump()
        except ValidationError as error:
            raise ProviderCallError("schema_mismatch", str(error)[:500], False) from error

    def _mock(self, request: StructuredGenerationRequest, validate_with: type[BaseModel]) -> ProviderResult:
        seed = int(hashlib.sha256((request.prompt_prefix + request.prompt_suffix).encode()).hexdigest()[:8], 16)
        data = synthesize_from_schema(request.json_schema, seed)
        validated = self._validate(data, validate_with)
        in_tok = (len(request.prompt_prefix) + len(request.prompt_suffix)) // 4
        out_tok = len(json.dumps(validated)) // 4
        return ProviderResult(
            data=validated,
            usage=TokenUsage(
                input_tokens=in_tok,
                output_tokens=out_tok,
                cached_input_tokens=0,
                cost_estimate_micro_usd=in_tok * 30 + out_tok * 250,
                usage_is_estimate=True,
            ),
            request_id=f"mock-{seed:x}",
            latency_ms=1,
            endpoint="local-mock",
        )

    def _gemini(self, request: StructuredGenerationRequest, validate_with: type[BaseModel]) -> ProviderResult:
        if not self.gemini_key:
            raise ProviderCallError("auth", "Gemini API key not configured", False)
        started = time.time()
        response = self._http.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{request.model_id}:generateContent",
            params={"key": self.gemini_key},
            json={
                "contents": [{"parts": [{"text": f"{request.prompt_prefix}\n\n{request.prompt_suffix}"}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": request.json_schema,
                    "temperature": request.temperature,
                    "maxOutputTokens": request.max_output_tokens,
                },
            },
        )
        if response.status_code == 429:
            raise ProviderCallError("rate_limit", response.text[:300], True)
        if response.status_code in (401, 403):
            raise ProviderCallError("auth", response.text[:300], False)
        if response.status_code >= 500:
            raise ProviderCallError("server_error", response.text[:300], True)
        if response.status_code != 200:
            raise ProviderCallError("network", response.text[:300], False)
        body = response.json()
        text = body["candidates"][0]["content"]["parts"][0]["text"]
        try:
            data = json.loads(text)
        except json.JSONDecodeError as error:
            raise ProviderCallError("invalid_response", "response was not valid JSON", False) from error
        validated = self._validate(data, validate_with)
        usage_meta = body.get("usageMetadata", {})
        return ProviderResult(
            data=validated,
            usage=TokenUsage(
                input_tokens=usage_meta.get("promptTokenCount", 0),
                output_tokens=usage_meta.get("candidatesTokenCount", 0),
                cached_input_tokens=usage_meta.get("cachedContentTokenCount", 0),
                usage_is_estimate=False,
            ),
            request_id=body.get("responseId", ""),
            latency_ms=int((time.time() - started) * 1000),
            endpoint="generativelanguage.googleapis.com",
            cache_metadata={"provider_cache_hit_tokens": usage_meta.get("cachedContentTokenCount", 0)},
        )

    def _openrouter(self, request: StructuredGenerationRequest, validate_with: type[BaseModel]) -> ProviderResult:
        if not self.openrouter_key:
            raise ProviderCallError("auth", "OpenRouter API key not configured", False)
        started = time.time()
        model = request.model_id.removeprefix("openrouter/")
        payload: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": request.prompt_prefix},
                {"role": "user", "content": request.prompt_suffix},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "crowdlens_structured_output",
                    "strict": True,
                    "schema": request.json_schema,
                },
            },
            "temperature": request.temperature,
            "max_tokens": request.max_output_tokens,
            "provider": {
                "require_parameters": True,
                **({"data_collection": "deny"} if request.data_policy and request.data_policy.data_collection == "deny" else {}),
                **({"zdr": True} if request.data_policy and request.data_policy.zdr else {}),
            },
        }
        if request.session_id:
            payload["session_id"] = request.session_id
            payload["user"] = f"cl-{request.session_id}"
        response = self._http.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {self.openrouter_key}",
                "HTTP-Referer": self.app_url,
                "X-Title": self.app_name,
            },
            json=payload,
        )
        if response.status_code == 429:
            raise ProviderCallError("rate_limit", response.text[:300], True)
        if response.status_code in (401, 403):
            raise ProviderCallError("auth", response.text[:300], False)
        if response.status_code >= 500:
            raise ProviderCallError("server_error", response.text[:300], True)
        if response.status_code != 200:
            raise ProviderCallError("network", response.text[:300], False)
        body = response.json()
        text = (body["choices"][0]["message"].get("content")) or ""
        try:
            data = json.loads(text)
        except json.JSONDecodeError as error:
            raise ProviderCallError("invalid_response", "response was not valid JSON", False) from error
        validated = self._validate(data, validate_with)
        usage = body.get("usage") or {}
        cache_hit = usage.get("prompt_cache_hit_tokens", 0)
        return ProviderResult(
            data=validated,
            usage=TokenUsage(
                input_tokens=usage.get("prompt_tokens", 0),
                output_tokens=usage.get("completion_tokens", 0),
                cached_input_tokens=cache_hit,
                usage_is_estimate=not bool(usage),
            ),
            request_id=body.get("id", ""),
            latency_ms=int((time.time() - started) * 1000),
            endpoint=body.get("model", ""),
            cache_metadata={"provider_cache_hit_tokens": cache_hit} if cache_hit else {},
        )


def resolve_provider_key(provider: str, workspace_secret: str, config_gemini: str, config_openrouter: str) -> str:
    if workspace_secret:
        return workspace_secret
    return config_gemini if provider == "gemini" else config_openrouter
