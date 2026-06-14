import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  NotImplementedException,
  Param,
  Post,
  Query,
  UseFilters,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AnchorService } from "./anchor.service";
import { AnchorExceptionFilter } from "./anchor-exception.filter";
import { EtherfuseClient } from "./lib/etherfuse";
import { AlfredPayClient } from "./lib/alfredpay";

type Body = Record<string, unknown>;

@ApiTags("anchor")
@UseFilters(AnchorExceptionFilter)
@Controller("anchor/:provider")
export class AnchorController {
  constructor(private readonly anchor: AnchorService) {}

  @Get("status")
  status(@Param("provider") provider: string) {
    if (provider !== "etherfuse" && provider !== "alfredpay") {
      throw new BadRequestException(`Invalid provider: ${provider}`);
    }
    return { provider, configured: this.anchor.isConfigured(provider) };
  }

  @Get("assets")
  async assets(
    @Param("provider") provider: string,
    @Query("wallet") wallet?: string
  ) {
    if (!wallet) {
      throw new BadRequestException("wallet query parameter is required");
    }
    const client = this.anchor.client(provider);
    if (!(client instanceof EtherfuseClient)) {
      throw new NotImplementedException(
        "Provider does not support asset listing"
      );
    }
    return client.getAssets("stellar", "mxn", wallet);
  }

  @Post("customers")
  @HttpCode(201)
  async createCustomer(
    @Param("provider") provider: string,
    @Body() body: Body
  ) {
    const {
      email,
      country = "MX",
      publicKey,
    } = body as {
      email?: string;
      country?: string;
      publicKey?: string;
    };
    const client = this.anchor.client(provider);
    return client.createCustomer({ email, country, publicKey });
  }

  @Get("customers")
  async getCustomer(
    @Param("provider") provider: string,
    @Query("email") email?: string,
    @Query("customerId") customerId?: string,
    @Query("country") country = "MX"
  ) {
    if (!email && !customerId) {
      throw new BadRequestException(
        "email or customerId query parameter is required"
      );
    }
    const client = this.anchor.client(provider);
    const customer = await client.getCustomer({
      email: email || undefined,
      customerId: customerId || undefined,
      country,
    });
    if (!customer) throw new NotFoundException("Customer not found");
    return customer;
  }

  @Post("quotes")
  async quotes(@Param("provider") provider: string, @Body() body: Body) {
    const {
      fromCurrency,
      toCurrency,
      fromAmount,
      toAmount,
      customerId,
      stellarAddress,
      resourceId,
    } = body as Record<string, string | undefined>;

    if (!fromCurrency || !toCurrency) {
      throw new BadRequestException("fromCurrency and toCurrency are required");
    }
    if (!fromAmount && !toAmount) {
      throw new BadRequestException(
        "Either fromAmount or toAmount is required"
      );
    }
    const client = this.anchor.client(provider);
    return client.getQuote({
      fromCurrency,
      toCurrency,
      fromAmount,
      toAmount,
      customerId,
      stellarAddress,
      resourceId,
    });
  }

  @Post("onramp")
  @HttpCode(201)
  async createOnRamp(@Param("provider") provider: string, @Body() body: Body) {
    const b = body as Record<string, string | undefined>;
    if (
      !b.customerId ||
      !b.quoteId ||
      !b.stellarAddress ||
      !b.fromCurrency ||
      !b.toCurrency ||
      !b.amount
    ) {
      throw new BadRequestException(
        "customerId, quoteId, stellarAddress, fromCurrency, toCurrency, and amount are required"
      );
    }
    const client = this.anchor.client(provider);
    return client.createOnRamp({
      customerId: b.customerId,
      quoteId: b.quoteId,
      stellarAddress: b.stellarAddress,
      fromCurrency: b.fromCurrency,
      toCurrency: b.toCurrency,
      amount: b.amount,
      memo: b.memo,
      bankAccountId: b.bankAccountId,
    });
  }

  @Get("onramp")
  async getOnRamp(
    @Param("provider") provider: string,
    @Query("transactionId") transactionId?: string
  ) {
    if (!transactionId) {
      throw new BadRequestException(
        "transactionId query parameter is required"
      );
    }
    const client = this.anchor.client(provider);
    const transaction = await client.getOnRampTransaction(transactionId);
    if (!transaction) throw new NotFoundException("Transaction not found");
    return transaction;
  }

  @Post("offramp")
  @HttpCode(201)
  async createOffRamp(@Param("provider") provider: string, @Body() body: Body) {
    const b = body as Record<string, unknown>;
    const customerId = b.customerId as string | undefined;
    const quoteId = b.quoteId as string | undefined;
    const stellarAddress = b.stellarAddress as string | undefined;
    const fromCurrency = b.fromCurrency as string | undefined;
    const toCurrency = b.toCurrency as string | undefined;
    const amount = b.amount as string | undefined;
    const existingFiatAccountId = b.fiatAccountId as string | undefined;
    const bankAccount = b.bankAccount as
      | { bankName?: string; clabe?: string; beneficiary?: string }
      | undefined;
    const memo = b.memo as string | undefined;

    if (
      !customerId ||
      !quoteId ||
      !stellarAddress ||
      !fromCurrency ||
      !toCurrency ||
      !amount
    ) {
      throw new BadRequestException(
        "customerId, quoteId, stellarAddress, fromCurrency, toCurrency, and amount are required"
      );
    }
    if (!existingFiatAccountId && !bankAccount) {
      throw new BadRequestException(
        "Either fiatAccountId or bankAccount is required"
      );
    }

    const client = this.anchor.client(provider);
    let fiatAccountId: string;
    if (existingFiatAccountId) {
      fiatAccountId = existingFiatAccountId;
    } else {
      const { bankName, clabe, beneficiary } = bankAccount!;
      if (!clabe || !beneficiary) {
        throw new BadRequestException(
          "bankAccount must include clabe and beneficiary"
        );
      }
      const fiatAccount = await client.registerFiatAccount({
        customerId,
        account: {
          type: "spei",
          clabe,
          bankName: bankName || undefined,
          beneficiary,
        },
      });
      fiatAccountId = fiatAccount.id;
    }

    return client.createOffRamp({
      customerId,
      quoteId,
      stellarAddress,
      fromCurrency,
      toCurrency,
      amount,
      fiatAccountId,
      memo,
    });
  }

  @Get("offramp")
  async getOffRamp(
    @Param("provider") provider: string,
    @Query("transactionId") transactionId?: string
  ) {
    if (!transactionId) {
      throw new BadRequestException(
        "transactionId query parameter is required"
      );
    }
    const client = this.anchor.client(provider);
    const transaction = await client.getOffRampTransaction(transactionId);
    if (!transaction) throw new NotFoundException("Transaction not found");
    return transaction;
  }

  @Post("offramp/sign")
  async signOffRamp(@Param("provider") provider: string, @Body() body: Body) {
    this.anchor.client(provider); // validate provider
    const { signedXdr, transactionId } = body as {
      signedXdr?: string;
      transactionId?: string;
    };
    if (!signedXdr) throw new BadRequestException("signedXdr is required");
    return this.anchor.submitSignedXdr(signedXdr, transactionId);
  }

  @Post("fiat-accounts")
  @HttpCode(201)
  async registerFiatAccount(
    @Param("provider") provider: string,
    @Body() body: Body
  ) {
    const { customerId, publicKey, bankName, clabe, beneficiary } = body as {
      customerId?: string;
      publicKey?: string;
      bankName?: string;
      clabe?: string;
      beneficiary?: string;
    };
    if (!customerId || !clabe || !beneficiary) {
      throw new BadRequestException(
        "customerId, clabe, and beneficiary are required"
      );
    }
    const client = this.anchor.client(provider);
    return client.registerFiatAccount({
      customerId,
      publicKey: publicKey || undefined,
      account: {
        type: "spei",
        clabe,
        bankName: bankName || undefined,
        beneficiary,
      },
    });
  }

  @Get("fiat-accounts")
  async getFiatAccounts(
    @Param("provider") provider: string,
    @Query("customerId") customerId?: string
  ) {
    if (!customerId) {
      throw new BadRequestException("customerId query parameter is required");
    }
    const client = this.anchor.client(provider);
    return client.getFiatAccounts(customerId);
  }

  @Get("kyc")
  async getKyc(
    @Param("provider") provider: string,
    @Query("customerId") customerId?: string,
    @Query("type") type = "status",
    @Query("country") country = "MX",
    @Query("publicKey") publicKey?: string,
    @Query("bankAccountId") bankAccountId?: string
  ) {
    const client = this.anchor.client(provider);

    if (type === "requirements") {
      if (!client.getKycRequirements) {
        throw new BadRequestException(
          "Provider does not support KYC requirements"
        );
      }
      return client.getKycRequirements(country);
    }

    if (type === "iframe" || type === "url") {
      if (!client.getKycUrl) {
        throw new NotImplementedException(
          "Provider does not support KYC URL generation"
        );
      }
      if (!customerId) {
        throw new BadRequestException("customerId query parameter is required");
      }
      const url = await client.getKycUrl(customerId, publicKey, bankAccountId);
      return { url };
    }

    if (type === "submission" && client instanceof AlfredPayClient) {
      if (!customerId) {
        throw new BadRequestException("customerId query parameter is required");
      }
      return { submission: await client.getKycSubmission(customerId) };
    }

    if (!customerId) {
      throw new BadRequestException("customerId query parameter is required");
    }
    return { status: await client.getKycStatus(customerId, publicKey) };
  }

  @Post("kyc")
  async postKyc(
    @Param("provider") provider: string,
    @Query("type") type: string | undefined,
    @Body() body: Body
  ) {
    const client = this.anchor.client(provider);

    if (type === "submit-kyc") {
      if (!client.submitKyc) {
        throw new BadRequestException(
          "Provider does not support KYC submission"
        );
      }
      const { customerId, data } = body as {
        customerId?: string;
        data?: Parameters<NonNullable<typeof client.submitKyc>>[1];
      };
      if (!customerId || !data) {
        throw new BadRequestException("customerId and data are required");
      }
      return client.submitKyc(customerId, data);
    }

    throw new BadRequestException('type query parameter must be "submit-kyc"');
  }

  @Post("sandbox")
  async sandbox(@Param("provider") provider: string, @Body() body: Body) {
    if (this.anchor.isMainnet()) {
      throw new ForbiddenException(
        "Sandbox endpoints are not available on mainnet"
      );
    }
    const { action } = body as { action?: string };
    if (!action) throw new BadRequestException("action is required");

    const client = this.anchor.client(provider);

    switch (action) {
      case "simulateFiatReceived": {
        if (!(client instanceof EtherfuseClient)) {
          throw new BadRequestException(
            "simulateFiatReceived is only supported for Etherfuse"
          );
        }
        const { orderId } = body as { orderId?: string };
        if (!orderId) {
          throw new BadRequestException(
            "orderId is required for simulateFiatReceived"
          );
        }
        const statusCode = await client.simulateFiatReceived(orderId);
        return { success: statusCode === 200, statusCode };
      }
      case "completeKyc": {
        if (!(client instanceof AlfredPayClient)) {
          throw new BadRequestException(
            "completeKyc is only supported for AlfredPay"
          );
        }
        const { submissionId } = body as { submissionId?: string };
        if (!submissionId) {
          throw new BadRequestException(
            "submissionId is required for completeKyc"
          );
        }
        await client.completeKycSandbox(submissionId);
        return { success: true, message: "KYC marked as completed" };
      }
      default:
        throw new BadRequestException(`Unknown action: ${action}`);
    }
  }
}
