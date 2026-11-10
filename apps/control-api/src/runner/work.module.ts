import { Global, Module } from "@nestjs/common";
import { WorkService } from "./work.service.js";

@Global()
@Module({
  providers: [WorkService],
  exports: [WorkService],
})
export class WorkModule {}
