import { Module } from "@nestjs/common";
import { EtherfuseController } from "./etherfuse.controller";
import { EtherfuseService } from "./etherfuse.service";

@Module({
  controllers: [EtherfuseController],
  providers: [EtherfuseService],
})
export class EtherfuseModule {}
