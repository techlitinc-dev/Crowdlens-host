import { Module } from "@nestjs/common";
import { SimulationsController } from "./simulations.controller.js";
import { SimulationsService } from "./simulations.service.js";
import { ReconcilerService } from "./reconciler.service.js";
import { Tx } from "../db/tx.js";
import { IdempotencyService } from "../common/idempotency.js";

@Module({
  controllers: [SimulationsController],
  providers: [SimulationsService, ReconcilerService, Tx, IdempotencyService],
  exports: [SimulationsService],
})
export class SimulationsModule {}
