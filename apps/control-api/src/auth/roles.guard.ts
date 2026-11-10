import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@crowdlens/contracts";
import { problems } from "../common/problem-details.js";
import { IS_PUBLIC_KEY } from "../common/public.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    if (isPublic) return true;

    const required =
      this.reflector.getAllAndOverride<Role[]>("roles", [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const role = req.tenant?.workspaceRole as Role | undefined;
    if (!role || !required.includes(role)) {
      throw problems.forbidden(`Requires one of roles: ${required.join(", ")}`);
    }
    return true;
  }
}
