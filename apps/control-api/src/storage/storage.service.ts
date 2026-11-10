import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { AppConfig, CONFIG_TOKEN } from "../config/env.js";

/**
 * Object storage port (DOC-02): originals and artifacts live in a private
 * bucket or local directory; all keys begin tenant/<workspace_uuid>/...
 * Adapters: filesystem (local dev) and S3-compatible (S3_ENDPOINT set).
 */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  /** Short-lived authorised URL (HMAC-capability locally, presigned for S3). */
  createSignedReadUrl(key: string, expiresSeconds: number): Promise<string>;
  remove(key: string): Promise<void>;
}

export function tenantKey(workspaceId: string, ...segments: string[]): string {
  return ["tenant", workspaceId, ...segments].join("/");
}

@Injectable()
export class FileSystemStorage implements ObjectStorage {
  private readonly logger = new Logger("fs-storage");

  constructor(
    private readonly baseDir: string,
    private readonly origin: string,
    private readonly secret: string,
  ) {}

  private resolve(key: string): string {
    const clean = normalize(key);
    if (clean.startsWith("..") || clean.includes(`..${sep}`) || clean.includes(`..${sep}`)) {
      throw new Error(`invalid object key: ${key}`);
    }
    const full = join(this.baseDir, clean);
    if (!full.startsWith(normalize(this.baseDir))) throw new Error(`invalid object key: ${key}`);
    return full;
  }

  private signature(key: string, expires: number): string {
    return createHmac("sha256", this.secret).update(`${key}:${expires}`).digest("base64url");
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const full = this.resolve(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async createSignedReadUrl(key: string, expiresSeconds: number): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + expiresSeconds;
    const sig = this.signature(key, expires);
    return `${this.origin}/v1/objects/read?key=${encodeURIComponent(key)}&exp=${expires}&sig=${sig}`;
  }

  async remove(key: string): Promise<void> {
    await unlink(this.resolve(key)).catch(() => undefined);
  }

  /** Verifies a locally-signed read URL (capability check, no session). */
  verifySignedRead(key: string, exp: number, sig: string): boolean {
    if (exp < Date.now() / 1000) return false;
    const expected = this.signature(key, exp);
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  streamPath(key: string): string {
    return this.resolve(key);
  }
}

export class S3Storage implements ObjectStorage {
  // Production adapter; instantiated lazily so local dev never loads the SDK.
  private constructor(private readonly client: unknown, private readonly config: AppConfig) {}

  static async create(config: AppConfig): Promise<S3Storage> {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_REFERENCE,
        secretAccessKey: config.S3_SECRET_KEY_REFERENCE,
      },
    });
    return new S3Storage(client, config);
  }

  private async s3() {
    const mod = await import("@aws-sdk/client-s3");
    return { mod, client: this.client as InstanceType<typeof mod.S3Client> };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const { mod, client } = await this.s3();
    await client.send(
      new mod.PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const { mod, client } = await this.s3();
    const out = await client.send(
      new mod.GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }),
    );
    return Buffer.from(await out.Body!.transformToByteArray());
  }

  async exists(key: string): Promise<boolean> {
    const { mod, client } = await this.s3();
    try {
      await client.send(new mod.HeadObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async createSignedReadUrl(key: string, expiresSeconds: number): Promise<string> {
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const { mod, client } = await this.s3();
    return getSignedUrl(
      client,
      new mod.GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }),
      { expiresIn: expiresSeconds },
    );
  }

  async remove(key: string): Promise<void> {
    const { mod, client } = await this.s3();
    await client.send(
      new mod.DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }),
    );
  }
}

export const OBJECT_STORAGE = "OBJECT_STORAGE";

@Injectable()
export class StorageFactory {
  private readonly logger = new Logger("storage");

  constructor(@Inject(CONFIG_TOKEN) private readonly config: AppConfig) {}

  async create(): Promise<ObjectStorage> {
    if (this.config.S3_ENDPOINT) {
      const storage = await S3Storage.create(this.config);
      this.logger.log("object storage: s3");
      return storage;
    }
    this.logger.log(`object storage: filesystem (${this.config.STORAGE_FS_DIR})`);
    return new FileSystemStorage(
      this.config.STORAGE_FS_DIR,
      this.config.CONTROL_API_ORIGIN,
      this.config.SESSION_SECRET_REFERENCE,
    );
  }
}

/** Streaming helper used by the signed-read controller (filesystem adapter). */
export { createReadStream };
