import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsString,
  Matches,
} from "class-validator";

/**
 * Upper bound on symbols per request.
 *
 * One request fans out to one upstream lookup per uncached symbol, so an
 * unbounded list is an amplification vector in the same way a JSON-RPC batch
 * is. The catalogue is well under this, which leaves room to grow without
 * letting a caller name arbitrarily many.
 */
export const MAX_SPOT_SYMBOLS = 40;

export class SpotSymbolsDto {
  @Transform(({ value }) => {
    if (typeof value !== "string") return value;
    const seen = new Set<string>();
    for (const part of value.split(",")) {
      const symbol = part.trim().toUpperCase();
      if (symbol) seen.add(symbol);
    }
    return [...seen];
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_SPOT_SYMBOLS)
  @IsString({ each: true })
  @Matches(/^[A-Z0-9]{1,16}$/, {
    each: true,
    message: "symbols must be alphanumeric asset codes",
  })
  symbols!: string[];
}
