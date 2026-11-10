import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import type { Role } from "@crowdlens/contracts";
import { WorkspacesService } from "./workspaces.service.js";
import { IdentityService } from "../auth/identity.service.js";
import { CanManageMembers, CanRead, Req } from "../auth/rbac.js";
import { problems } from "../common/problem-details.js";
import { buildPage, cursorQuerySchema } from "../common/pagination.js";
import { WorkspaceContextOptional } from "../common/public.js";
import type { TenantRequest } from "../auth/auth-context.js";
import { Inject } from "@nestjs/common";
import pg from "pg";
import { PG_APP_POOL } from "../db/pg.module.js";

const createSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().max(60).optional(),
});

const inviteSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(["owner", "admin", "analyst", "viewer", "billing_admin"]),
});

const rolePatchSchema = z.object({
  role: z.enum(["owner", "admin", "analyst", "viewer", "billing_admin"]),
});

@Controller("v1/workspaces")
export class WorkspacesController {
  constructor(
    @Inject(WorkspacesService) private readonly workspaces: WorkspacesService,
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(PG_APP_POOL) private readonly pool: pg.Pool,
  ) {}

  @Post()
  @WorkspaceContextOptional()
  async create(@Req() req: TenantRequest, @Body() body: unknown) {
    const input = createSchema.parse(body);
    const workspace = await this.workspaces.create(req.auth.userId, input);
    return { workspace };
  }

  @Get()
  @WorkspaceContextOptional()
  async list(@Req() req: TenantRequest) {
    return { workspaces: await this.workspaces.listForUser(req.auth.userId) };
  }

  @Get(":id")
  @CanRead()
  async get(@Req() req: TenantRequest, @Param("id") id: string) {
    this.assertScope(req, id);
    const { rows } = await this.pool.query(
      `SELECT id, slug, name, status, plan_code, authz_epoch, created_at
       FROM workspaces WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw problems.notFound("workspace");
    return { workspace: rows[0], role: req.workspaceRole, authz_epoch: req.authzEpoch };
  }

  @Get(":id/members")
  @CanManageMembers()
  async listMembers(@Req() req: TenantRequest, @Param("id") id: string) {
    this.assertScope(req, id);
    return { members: await this.workspaces.members(id) };
  }

  @Post(":id/members")
  @CanManageMembers()
  async invite(@Req() req: TenantRequest, @Param("id") id: string, @Body() body: unknown) {
    this.assertScope(req, id);
    const input = inviteSchema.parse(body);
    if (input.role === "owner") throw problems.forbidden("Use role change to grant ownership");
    const email = input.email.toLowerCase();
    // Dev identity: invited users are provisioned so membership can attach.
    const user = await this.identity.provision({
      issuer: "dev",
      subject: email,
      email,
      displayName: email.split("@")[0]!,
    });
    await this.workspaces.upsertMember({
      workspaceId: id,
      actorId: req.auth.userId,
      userId: user.id,
      role: input.role as Role,
    });
    return { member: { user_id: user.id, email: user.email, role: input.role } };
  }

  @Patch(":id/members/:userId")
  @CanManageMembers()
  async changeRole(
    @Req() req: TenantRequest,
    @Param("id") id: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    this.assertScope(req, id);
    const input = rolePatchSchema.parse(body);
    if (userId === req.auth.userId && input.role !== "owner") {
      throw problems.conflict("Owners cannot demote themselves");
    }
    await this.workspaces.upsertMember({
      workspaceId: id,
      actorId: req.auth.userId,
      userId,
      role: input.role,
    });
    return { ok: true };
  }

  @Delete(":id/members/:userId")
  @CanManageMembers()
  async removeMember(
    @Req() req: TenantRequest,
    @Param("id") id: string,
    @Param("userId") userId: string,
  ) {
    this.assertScope(req, id);
    await this.workspaces.removeMember({ workspaceId: id, actorId: req.auth.userId, userId });
    return { ok: true };
  }

  @Get(":id/audit")
  @CanManageMembers()
  async auditLog(
    @Req() req: TenantRequest,
    @Param("id") id: string,
    @Query() query: Record<string, string>,
  ) {
    this.assertScope(req, id);
    const { cursor, limit } = cursorQuerySchema.parse(query);
    const cursorClause = cursor ? `AND (created_at, id) < ($2, $3)` : "";
    const params: unknown[] = cursor ? [id, cursor.split("|")[0], cursor.split("|")[1]] : [id];
    const { rows } = await this.pool.query(
      `SELECT id, actor, action, target_type, target_id, request_id, metadata, created_at
       FROM audit_logs
       WHERE workspace_id = $1 ${cursorClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ${limit + 1}`,
      params as string[],
    );
    return buildPage(rows as unknown as Record<string, unknown>[], limit, "created_at", "id");
  }

  private assertScope(req: TenantRequest, id: string): void {
    if (req.workspaceId !== id) {
      throw problems.forbidden("Workspace context does not match the requested resource");
    }
  }
}
