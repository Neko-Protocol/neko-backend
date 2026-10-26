import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { SimilarApplicationsQueryDto } from "./similar-applications-query.dto";

describe("SimilarApplicationsQueryDto", () => {
  it("defaults to five cases", async () => {
    const query = plainToInstance(SimilarApplicationsQueryDto, {});
    expect(query.limit).toBe(5);
    expect(await validate(query)).toEqual([]);
  });

  it.each(["1", "5", "20"])("accepts limit=%s", async (limit) => {
    const query = plainToInstance(SimilarApplicationsQueryDto, { limit });
    expect(query.limit).toBe(Number(limit));
    expect(await validate(query)).toEqual([]);
  });

  it.each(["0", "-1", "21", "1.5", "invalid", "", ["5", "10"]])(
    "rejects invalid limit %j",
    async (limit) => {
      const query = plainToInstance(SimilarApplicationsQueryDto, { limit });
      expect(await validate(query)).not.toHaveLength(0);
    }
  );
});
