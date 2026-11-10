import { Global, Module } from "@nestjs/common";
import { IdentityService } from "./identity.service.js";
import { SessionService } from "./session.service.js";
import { TenantAuthGuard } from "./tenant-auth.guard.js";
import { RolesGuard } from "./roles.guard.js";
import { AuthController } from "./auth.controller.js";
import { AuditService, OutboxService } from "../audit/audit.service.js";

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    IdentityService,
    SessionService,
    TenantAuthGuard,
    RolesGuard,
    AuditService,
    OutboxService,
  ],
  exports: [IdentityService, SessionService, TenantAuthGuard, RolesGuard, AuditService, OutboxService],
})
export class AuthModule {}
