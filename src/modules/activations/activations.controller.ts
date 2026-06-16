import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import {
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ActivationsService } from "./activations.service";
import { CancelPayoutDto } from "./dto/cancel-payout.dto";
import { CreateActivationDto } from "./dto/create-activation.dto";
import { PrepareBatchPayoutDto } from "./dto/prepare-batch-payout.dto";
import { PreparePayoutDto } from "./dto/prepare-payout.dto";
import { SubmitBatchPayoutDto } from "./dto/submit-batch-payout.dto";
import { SubmitPayoutDto } from "./dto/submit-payout.dto";

@ApiTags("activations")
@ApiTooManyRequestsResponse({ description: "Rate-limited." })
@Controller("activations")
export class ActivationsController {
  constructor(private readonly svc: ActivationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create an activation with its email list." })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@Body() dto: CreateActivationDto) {
    return this.svc.create(dto);
  }

  @Get()
  @ApiOperation({ summary: "List activations with participant progress." })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  list() {
    return this.svc.list();
  }

  @Get("payable")
  @ApiOperation({ summary: "All participants currently awaiting payout." })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  listPayable() {
    return this.svc.listPayable();
  }

  @Get(":id")
  @ApiOperation({ summary: "Activation detail with full participant list." })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getById(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.getById(id);
  }

  @Post("payouts/prepare")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Lock a payable participant and build the XLM payment XDR.",
  })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  preparePayout(@Body() dto: PreparePayoutDto) {
    return this.svc.preparePayout(dto);
  }

  @Post("payouts/prepare-batch")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Lock all payable participants and build one batched XLM payout XDR (max 100 ops).",
  })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  prepareBatchPayout(@Body() dto: PrepareBatchPayoutDto) {
    return this.svc.prepareBatchPayout(dto);
  }

  @Post("payouts/submit")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Submit the signed payout and mark the participant paid.",
  })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  submitPayout(@Body() dto: SubmitPayoutDto) {
    return this.svc.submitPayout(dto);
  }

  @Post("payouts/submit-batch")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Submit the signed batched payout and mark all included participants paid.",
  })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  submitBatchPayout(@Body() dto: SubmitBatchPayoutDto) {
    return this.svc.submitBatchPayout(dto);
  }

  @Post("payouts/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Release a payout lock (signature rejected)." })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  cancelPayout(@Body() dto: CancelPayoutDto) {
    return this.svc.cancelPayout(dto.participant_id);
  }

  @Post(":id/send-invites")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Resend invitation emails to still-pending participants.",
  })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  sendInvites(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.sendInvites(id);
  }
}
