import { Controller, Get, Inject, Module, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { createReadStream, FileSystemStorage, OBJECT_STORAGE, StorageFactory, type ObjectStorage } from "./storage.service.js";
import { Public } from "../common/public.js";
import { problems } from "../common/problem-details.js";

/** Signed-object read endpoint: capability URL, no session (§12.9 no-store). */
@Controller("v1/objects")
export class ObjectsController {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  @Public()
  @Get("read")
  async read(
    @Query("key") key: string,
    @Query("exp") exp: string,
    @Query("sig") sig: string,
    @Res() res: Response,
  ) {
    if (!(this.storage instanceof FileSystemStorage)) {
      throw problems.notFound("object");
    }
    const expires = Number(exp);
    if (!key || Number.isNaN(expires) || !sig || !this.storage.verifySignedRead(key, expires, sig)) {
      throw problems.forbidden("Invalid or expired object signature");
    }
    if (!(await this.storage.exists(key))) throw problems.notFound("object");
    res.setHeader("Cache-Control", "private, no-store");
    createReadStream(this.storage.streamPath(key)).pipe(res);
  }
}

@Module({
  controllers: [ObjectsController],
  providers: [
    StorageFactory,
    {
      provide: OBJECT_STORAGE,
      useFactory: (factory: StorageFactory) => factory.create(),
      inject: [StorageFactory],
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
