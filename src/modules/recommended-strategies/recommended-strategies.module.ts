import { Module } from "@nestjs/common";
import { RecommendedStrategiesController } from "./recommended-strategies.controller";
import { RecommendedStrategiesService } from "./recommended-strategies.service";
import { StrategiesPublicController } from "./strategies-public.controller";

@Module({
  controllers: [RecommendedStrategiesController, StrategiesPublicController],
  providers: [RecommendedStrategiesService],
})
export class RecommendedStrategiesModule {}
