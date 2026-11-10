"""Object storage port for workers: filesystem (local) or S3-compatible."""

from __future__ import annotations

from pathlib import Path

from .config import WorkerConfig


class ObjectStorage:
    def put(self, key: str, body: bytes) -> None: ...
    def get(self, key: str) -> bytes: ...
    def exists(self, key: str) -> bool: ...
    def remove(self, key: str) -> None: ...


class FileSystemStorage(ObjectStorage):
    def __init__(self, base_dir: str) -> None:
        self.base = Path(base_dir).resolve()

    def _resolve(self, key: str) -> Path:
        full = (self.base / key).resolve()
        if not str(full).startswith(str(self.base)):
            raise ValueError(f"invalid object key: {key}")
        return full

    def put(self, key: str, body: bytes) -> None:
        full = self._resolve(key)
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_bytes(body)

    def get(self, key: str) -> bytes:
        return self._resolve(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._resolve(key).exists()

    def remove(self, key: str) -> None:
        self._resolve(key).unlink(missing_ok=True)


class S3Storage(ObjectStorage):
    def __init__(self, config: WorkerConfig) -> None:
        import boto3  # type: ignore[import-not-found]

        self._bucket = config.s3_bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=config.s3_endpoint,
            region_name=config.s3_region,
            aws_access_key_id=config.s3_access_key,
            aws_secret_access_key=config.s3_secret_key,
        )

    def put(self, key: str, body: bytes) -> None:
        self._client.put_object(Bucket=self._bucket, Key=key, Body=body)

    def get(self, key: str) -> bytes:
        return self._client.get_object(Bucket=self._bucket, Key=key)["Body"].read()

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError:
            return False

    def remove(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)


def open_storage(config: WorkerConfig) -> ObjectStorage:
    if config.uses_s3:
        return S3Storage(config)
    return FileSystemStorage(config.storage_fs_dir)
