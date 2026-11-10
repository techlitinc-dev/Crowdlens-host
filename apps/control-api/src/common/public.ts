import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";
/** Marks routes that skip session auth (webhooks, public share views, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const CSRF_EXEMPT_KEY = "csrfExempt";
/** Mutation routes exempt from the CSRF header check (e.g. webhook raw body). */
export const CsrfExempt = () => SetMetadata(CSRF_EXEMPT_KEY, true);

export const WORKSPACE_OPTIONAL_KEY = "workspaceOptional";
/**
 * Marks authenticated routes that legitimately run without an x-workspace-id
 * header (workspace creation, listing my workspaces). Every other route
 * requires explicit workspace context so a missing header fails closed with
 * 403 instead of an opaque database error.
 */
export const WorkspaceContextOptional = () => SetMetadata(WORKSPACE_OPTIONAL_KEY, true);
