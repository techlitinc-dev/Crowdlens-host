import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "./config/config.module.js";
import { PgModule } from "./db/pg.module.js";
import { CacheModule } from "./cache/cache.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { TenantAuthGuard } from "./auth/tenant-auth.guard.js";
import { RolesGuard } from "./auth/roles.guard.js";
import { WorkspacesModule } from "./workspaces/workspaces.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { DocumentsModule } from "./documents/documents.module.js";
import { WorkModule } from "./runner/work.module.js";
import { ProvidersModule } from "./providers/providers.module.js";
import { BillingModule } from "./billing/billing.module.js";
import { SimulationsModule } from "./simulations/simulations.module.js";
import { ReportsModule } from "./reports/reports.module.js";
import { ProblemDetailsFilter } from "./common/problem-details.filter.js";
import { Controller, Get } from "@nestjs/common";
import { Public } from "./common/public.js";

@Controller()
class HealthController {
  @Public()
  @Get("healthz")
  health() {
    return { status: "ok", service: "crowdlens-control-api" };
  }
}

@Module({
  imports: [ConfigModule, PgModule, CacheModule, AuthModule, WorkspacesModule, StorageModule, DocumentsModule, WorkModule, ProvidersModule, BillingModule, SimulationsModule, ReportsModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: TenantAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
