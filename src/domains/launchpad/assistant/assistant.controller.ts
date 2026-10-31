import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Res,
  UnauthorizedException,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { LaunchpadErrorCode } from "../launchpad.types";
import {
  AssistantStorageService,
  MAX_ASSISTANT_FILES,
  MAX_ASSISTANT_FILE_BYTES,
  assistantFileType,
  type SessionDocument,
} from "./assistant-storage.service";
import { AssistantService } from "./assistant.service";
import { AssistantChatDto } from "./dto/assistant-chat.dto";

export function bearerToken(authorization?: string): string {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    throw new UnauthorizedException({
      code: LaunchpadErrorCode.MISSING_ACCESS_TOKEN,
    });
  }
  return token;
}

@ApiTags("launchpad-assistant")
@ApiTooManyRequestsResponse({ description: "Rate-limited." })
@ApiBearerAuth()
@Controller("launchpad/assistant")
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly storage: AssistantStorageService
  ) {}

  @Post("chat")
  @ApiOperation({
    summary: "Chat with the application assistant (server-sent events).",
  })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async chat(
    @Body() dto: AssistantChatDto,
    @Res() res: Response,
    @Headers("authorization") authorization?: string
  ): Promise<void> {
    await this.assistant.streamChat(bearerToken(authorization), dto, res);
  }

  @Get("sessions/:sessionId/documents")
  @ApiOperation({
    summary: "Documents shared with the assistant in this session.",
  })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async listDocuments(
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Headers("authorization") authorization?: string
  ): Promise<{ documents: SessionDocument[] }> {
    const prefix = await this.assistant.openSession(
      bearerToken(authorization),
      sessionId
    );
    return { documents: await this.storage.listDocuments(prefix) };
  }

  @Post("sessions/:sessionId/documents")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Share a document with the assistant." })
  @ApiConsumes("multipart/form-data")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_ASSISTANT_FILE_BYTES } })
  )
  async uploadDocument(
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Headers("authorization") authorization?: string
  ): Promise<{ document: SessionDocument }> {
    const prefix = await this.assistant.openSession(
      bearerToken(authorization),
      sessionId
    );
    if (!file) throw new BadRequestException({ code: "FILE_REQUIRED" });
    if (file.size > MAX_ASSISTANT_FILE_BYTES) {
      throw new PayloadTooLargeException({
        code: "FILE_TOO_LARGE",
        message: "Files can be up to 10 MB.",
      });
    }
    const type = assistantFileType(file.originalname);
    if (!type) {
      throw new UnsupportedMediaTypeException({
        code: "UNSUPPORTED_TYPE",
        message:
          "Use PDF, TXT, MD, CSV, JSON, PNG, JPG, WEBP or GIF. Export Word files as PDF.",
      });
    }
    if (
      (await this.storage.listDocuments(prefix)).length >= MAX_ASSISTANT_FILES
    ) {
      throw new ConflictException({
        code: "TOO_MANY_FILES",
        message: `Up to ${MAX_ASSISTANT_FILES} files per application.`,
      });
    }
    return {
      document: await this.storage.uploadDocument(prefix, file, type.mediaType),
    };
  }

  @Delete("sessions/:sessionId/documents/:name")
  @ApiOperation({ summary: "Remove a document from the assistant." })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async removeDocument(
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Param("name") name: string,
    @Headers("authorization") authorization?: string
  ): Promise<{ deleted: number }> {
    const prefix = await this.assistant.openSession(
      bearerToken(authorization),
      sessionId
    );
    const target = (await this.storage.listDocuments(prefix)).filter(
      (d) => d.path === `${prefix}/${name}`
    );
    await this.storage.removeDocuments(target.map((d) => d.path));
    return { deleted: target.length };
  }

  @Delete("sessions/:sessionId")
  @ApiOperation({
    summary: "Discard the session: deletes its documents and closes the chat.",
  })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async discard(
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Headers("authorization") authorization?: string
  ): Promise<{ closed: true }> {
    const account = await this.assistant.verifiedAccount(
      bearerToken(authorization)
    );
    await this.storage.closeSession(
      this.storage.prefix(account.account.id, sessionId)
    );
    return { closed: true };
  }
}
