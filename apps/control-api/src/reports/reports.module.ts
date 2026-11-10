import { Module } from "@nestjs/common";
import { ReportsController } from "./reports.controller.js";
import { GraphController } from "../graph/graph.controller.js";
import { StorageModule } from "../storage/storage.module.js";
import { Tx } from "../db/tx.js";
import { WorkService } from "../runner/work.service.js";

@Module({
  imports: [StorageModule],
  controllers: [ReportsController, GraphController],
  providers: [Tx, WorkService],
})
export class ReportsModule {}
