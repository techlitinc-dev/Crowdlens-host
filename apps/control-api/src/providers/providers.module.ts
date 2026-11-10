import { Global, Module } from "@nestjs/common";
import { ProvidersController } from "./providers.controller.js";
import { ProviderGateway } from "./provider-gateway.service.js";
import { ProviderConfigService } from "./provider-config.service.js";
import { Tx } from "../db/tx.js";

@Global()
@Module({
  controllers: [ProvidersController],
  providers: [ProviderGateway, ProviderConfigService, Tx],
  exports: [ProviderGateway, ProviderConfigService],
})
export class ProvidersModule {}
