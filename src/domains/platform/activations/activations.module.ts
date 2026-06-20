import { Module } from "@nestjs/common";
import { ActivationsController } from "./activations.controller";
import { ActivationsService } from "./activations.service";

@Module({
  controllers: [ActivationsController],
  providers: [ActivationsService],
})
export class ActivationsModule {}
