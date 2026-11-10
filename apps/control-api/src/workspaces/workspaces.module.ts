import { Module } from "@nestjs/common";
import { WorkspacesService } from "./workspaces.service.js";
import { WorkspacesController } from "./workspaces.controller.js";

@Module({
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
