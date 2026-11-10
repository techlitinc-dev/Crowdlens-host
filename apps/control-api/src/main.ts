import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { CONFIG_TOKEN, configSummary, type AppConfig } from "./config/env.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: true,
  });
  const config = app.get<AppConfig>(CONFIG_TOKEN);

  // Strict CORS: explicit origin allowlist only (no wildcard — §14.2).
  app.enableCors({
    origin: [config.WEB_ORIGIN],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-csrf-token", "x-workspace-id", "x-request-id", "idempotency-key"],
  });
  app.setGlobalPrefix("");
  app.useBodyParser("json", { limit: "2mb" });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ msg: "config", ...configSummary(config) }));
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ msg: "listening", port }));
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
