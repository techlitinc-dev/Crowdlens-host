import { Inject, Injectable } from "@nestjs/common";
import pg from "pg";
import { PG_APP_POOL } from "../db/pg.module.js";

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
}

@Injectable()
export class IdentityService {
  constructor(@Inject(PG_APP_POOL) private readonly pool: pg.Pool) {}

  /**
   * Dev provider: identity is keyed by email. OIDC: keyed by issuer+subject.
   * Provisioning goes through the SECURITY DEFINER provision_user() function
   * (migration 0004); reads run under the user's own RLS context.
   */
  async provision(input: {
    issuer: string;
    subject: string;
    email: string;
    displayName: string;
  }): Promise<UserRow> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ provision_user: string }>(
        `SELECT provision_user($1, $2, $3, $4) AS provision_user`,
        [input.issuer, input.subject, input.email, input.displayName],
      );
      const userId = rows[0]!.provision_user;
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      const user = await client.query<UserRow>(
        `SELECT id, email, display_name FROM users WHERE id = $1`,
        [userId],
      );
      await client.query("COMMIT");
      return user.rows[0]!;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async byId(userId: string): Promise<UserRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      const { rows } = await client.query<UserRow>(
        `SELECT id, email, display_name FROM users WHERE id = $1`,
        [userId],
      );
      await client.query("COMMIT");
      return rows[0] ?? null;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
