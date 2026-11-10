import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import express from "express";
import { DocumentsController } from "./documents.controller.js";
import { ProjectsController } from "../projects/projects.controller.js";
import { StorageModule } from "../storage/storage.module.js";
import { Tx } from "../db/tx.js";
import { WorkService } from "../runner/work.service.js";
import { IdempotencyService } from "../common/idempotency.js";

const rawDocumentBody = express.raw({
  type: () => true,
  limit: "50mb",
});

@Module({
  imports: [StorageModule],
  controllers: [DocumentsController, ProjectsController],
  providers: [Tx, WorkService, IdempotencyService],
})
export class DocumentsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(rawDocumentBody)
      .forRoutes({ path: "v1/documents/:id/content", method: RequestMethod.PUT });
  }
}
