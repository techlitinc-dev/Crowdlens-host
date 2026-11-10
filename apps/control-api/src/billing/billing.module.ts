import { Global, Module } from "@nestjs/common";
import { BillingController } from "./billing.controller.js";
import { RazorpayWebhookController } from "./webhook.controller.js";
import { LedgerService } from "./ledger.service.js";
import { RazorpayClient } from "./razorpay.client.js";
import { Tx } from "../db/tx.js";

@Global()
@Module({
  controllers: [BillingController, RazorpayWebhookController],
  providers: [LedgerService, RazorpayClient, Tx],
  exports: [LedgerService],
})
export class BillingModule {}
