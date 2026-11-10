import { SetMetadata, createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Role } from "@crowdlens/contracts";
import type { TenantRequest } from "./auth-context.js";

/**
 * Five-role RBAC matrix (specs.md §3, ACC-03). Server-side only.
 *
 * owner:         all workspace settings, members, providers, billing, delete
 * admin:         members, providers, runs, projects; billing view
 * analyst:       create/run/share/export scenarios
 * viewer:        read projects/reports
 * billing_admin: billing and usage only
 */
export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  owner: ["workspace.manage", "members.manage", "providers.manage", "billing.manage", "project.write", "project.read", "simulation.run", "simulation.read", "report.share", "report.export", "data.manage"],
  admin: ["members.manage", "providers.manage", "billing.read", "project.write", "project.read", "simulation.run", "simulation.read", "report.share", "report.export"],
  analyst: ["project.write", "project.read", "simulation.run", "simulation.read", "report.share", "report.export"],
  viewer: ["project.read", "simulation.read"],
  billing_admin: ["billing.manage", "billing.read"],
};

export function roleCan(role: Role, permission: string): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export const ROLES_KEY = "roles";
export const Roles = (roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Minimum-role style helpers expressed as explicit role lists. */
export const CanRun = () => Roles(["owner", "admin", "analyst"]);
export const CanWriteProject = () => Roles(["owner", "admin", "analyst"]);
export const CanRead = () => Roles(["owner", "admin", "analyst", "viewer", "billing_admin"]);
export const CanManageMembers = () => Roles(["owner", "admin"]);
export const CanManageProviders = () => Roles(["owner", "admin"]);
export const CanManageBilling = () => Roles(["owner", "billing_admin"]);

export const Req = createParamDecorator((_data: unknown, ctx: ExecutionContext): TenantRequest => {
  return ctx.switchToHttp().getRequest().tenant as TenantRequest;
});
