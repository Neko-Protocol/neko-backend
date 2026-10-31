import { Global, Module } from "@nestjs/common";
import { DiditService } from "./didit.service";

@Global()
@Module({
  providers: [DiditService],
  exports: [DiditService],
})
export class DiditModule {}
