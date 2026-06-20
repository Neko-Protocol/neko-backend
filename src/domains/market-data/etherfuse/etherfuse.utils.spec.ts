import {
  EtherfuseBondYieldsError,
  mapBondCostPayload,
} from "./etherfuse.utils";

describe("etherfuse.utils", () => {
  describe("mapBondCostPayload", () => {
    it("throws for invalid payloads", () => {
      expect(() => mapBondCostPayload(null)).toThrow(EtherfuseBondYieldsError);
      expect(() => mapBondCostPayload([])).toThrow(EtherfuseBondYieldsError);
      expect(() => mapBondCostPayload("bad")).toThrow(EtherfuseBondYieldsError);
    });

    it("converts basis points to APY for all target symbols", () => {
      const entries = mapBondCostPayload({
        a: {
          bond_symbol: "cetes",
          current_basis_points: 950,
          currency: "MXN",
          current_time: "2026-01-01T00:00:00.000Z",
        },
        b: {
          bond_symbol: "USTRY",
          current_basis_points: 480,
          currency: "USD",
          current_time: "2026-01-01T00:00:00.000Z",
        },
        c: {
          bond_symbol: "TESOURO",
          current_basis_points: 1350,
          currency: "BRL",
          current_time: "2026-01-01T00:00:00.000Z",
        },
      });

      expect(entries).toHaveLength(3);
      expect(entries.find((e) => e.symbol === "CETES")).toEqual({
        symbol: "CETES",
        apy: 9.5,
        currency: "MXN",
        lastUpdated: "2026-01-01T00:00:00.000Z",
      });
    });

    it("picks the row with the newest current_time", () => {
      const entries = mapBondCostPayload({
        a: {
          bond_symbol: "CETES",
          current_basis_points: 900,
          currency: "MXN",
          current_time: "2026-01-01T00:00:00.000Z",
        },
        b: {
          bond_symbol: "CETES",
          current_basis_points: 800,
          currency: "MXN",
          current_time: "2026-02-01T00:00:00.000Z",
        },
        u: {
          bond_symbol: "USTRY",
          current_basis_points: 480,
          currency: "USD",
          current_time: "2026-01-01T00:00:00.000Z",
        },
        t: {
          bond_symbol: "TESOURO",
          current_basis_points: 1350,
          currency: "BRL",
          current_time: "2026-01-01T00:00:00.000Z",
        },
      });

      expect(entries.find((e) => e.symbol === "CETES")?.apy).toBe(8);
    });

    it("throws when a target symbol is missing", () => {
      expect(() =>
        mapBondCostPayload({
          a: {
            bond_symbol: "CETES",
            current_basis_points: 950,
            currency: "MXN",
            current_time: "2026-01-01T00:00:00.000Z",
          },
        })
      ).toThrow(/Missing bond cost data/);
    });

    it("throws when a row has invalid fields", () => {
      expect(() =>
        mapBondCostPayload({
          a: {
            bond_symbol: "CETES",
            current_basis_points: -1,
            currency: "MXN",
            current_time: "2026-01-01T00:00:00.000Z",
          },
          b: {
            bond_symbol: "USTRY",
            current_basis_points: 480,
            currency: "USD",
            current_time: "2026-01-01T00:00:00.000Z",
          },
          c: {
            bond_symbol: "TESOURO",
            current_basis_points: 1350,
            currency: "BRL",
            current_time: "2026-01-01T00:00:00.000Z",
          },
        })
      ).toThrow(/Invalid bond cost row/);
    });
  });
});
