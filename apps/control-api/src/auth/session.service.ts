import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import pg from "pg";
import { AppConfig, CONFIG_TOKEN } from "../config/env.js";
import { PG_APP_POOL } from "../db/pg.module.js";

const SESSION_TTL_SECONDS = 14 * 24 * 3600;
const ROTATE_AFTER_SECONDS = 12 * 3600;

export interface SessionRecord {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  csrf_token: string;
  expires_at: Date;
  created_at: Date;
  rotated_from: string | null;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(PG_APP_POOL) private readonly pool: pg.Pool,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  private hash(token: string): string {
    return createHash("sha256")
      .update(token + this.config.SESSION_SECRET_REFERENCE)
      .digest("hex");
  }

  async create(userId: string): Promise<{ token: string; csrf: string; maxAge: number }> {
    const token = randomBytes(32).toString("base64url");
    const csrf = randomBytes(24).toString("base64url");
    await this.pool.query(
      `INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at)
       VALUES ($1, $2, $3, now() + interval '14 days')`,
      [userId, this.hash(token), csrf],
    );
    return { token, csrf, maxAge: SESSION_TTL_SECONDS };
  }

  /**
   * Validates a session token. Returns the session plus a rotation token when
   * the session is due for rotation (server-side rotation, §14.2).
   * Runs in one transaction: sessions are looked up by unguessable hash, then
   * the user row is read under that user's RLS context.
   */
  async validate(
    token: string,
  ): Promise<{ session: SessionRecord; rotatedToken: string | null } | null> {
    const hash = this.hash(token);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // 1) Sessions are reachable by unguessable hash (open policy, no context).
      const { rows: sessionRows } = await client.query<Omit<SessionRecord, "email" | "display_name">>(
        `SELECT id, user_id, csrf_token, expires_at, created_at, rotated_from
         FROM sessions
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
        [hash],
      );
      const sessionRow = sessionRows[0];
      if (!sessionRow) {
        await client.query("ROLLBACK");
        return null;
      }
      // 2) Pin the user's RLS context, then read their profile row.
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [sessionRow.user_id]);
      const { rows: userRows } = await client.query<{ email: string; display_name: string }>(
        `SELECT email, display_name FROM users WHERE id = $1`,
        [sessionRow.user_id],
      );
      const session: SessionRecord = {
        ...sessionRow,
        email: userRows[0]?.email ?? "",
        display_name: userRows[0]?.display_name ?? "",
      };
      const ageSeconds = (Date.now() - session.created_at.getTime()) / 1000;
      if (ageSeconds > ROTATE_AFTER_SECONDS && !session.rotated_from) {
        const newToken = randomBytes(32).toString("base64url");
        await client.query(
          `UPDATE sessions SET token_hash = $1, rotated_from = id WHERE id = $2`,
          [this.hash(newToken), session.id],
        );
        await client.query("COMMIT");
        return { session, rotatedToken: newToken };
      }
      await client.query("COMMIT");
      return { session, rotatedToken: null };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async revoke(token: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1`, [
      this.hash(token),
    ]);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.pool.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1`, [userId]);
  }

  verifyCsrf(session: SessionRecord, presented: string | undefined): boolean {
    if (!presented) return false;
    const a = Buffer.from(session.csrf_token);
    const b = Buffer.from(presented);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
