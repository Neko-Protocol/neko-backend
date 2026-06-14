import { Module } from "@nestjs/common";
import { RecommendedStrategiesController } from "./recommended-strategies.controller";
import { RecommendedStrategiesService } from "./recommended-strategies.service";

@Module({
  controllers: [RecommendedStrategiesController],
  providers: [RecommendedStrategiesService],
})
export class RecommendedStrategiesModule {}
