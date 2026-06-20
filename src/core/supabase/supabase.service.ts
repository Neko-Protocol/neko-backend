import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private _client!: SupabaseClient;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>("SUPABASE_URL");
    const serviceRoleKey = this.config.get<string>("SUPABASE_SERVICE_ROLE_KEY");

    if (!url || !serviceRoleKey) {
      throw new Error(
        "Missing Supabase configuration: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."
      );
    }

    this._client = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    this.logger.log("Supabase client initialized");
  }

  get client(): SupabaseClient {
    return this._client;
  }
}
