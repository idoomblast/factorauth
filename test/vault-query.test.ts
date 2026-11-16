import { describe, expect, test } from "bun:test";
import { buildVaultFilter, escapeLike, pageWindow } from "../src/vault-query.ts";

describe("vault search filter", () => {
  test("escapes LIKE wildcards", () => {
    expect(escapeLike("100%_a!b")).toBe("100!%!_a!!b");
    expect(escapeLike("vultr")).toBe("vultr");
  });

  test("searches label, issuer, account and notes inside one user", () => {
    const filter = buildVaultFilter(7, "vultr");
    expect(filter.sql).toContain("user_id = ?");
    expect(filter.sql).toContain("label LIKE ? ESCAPE '!'");
    expect(filter.sql).toContain("issuer LIKE ? ESCAPE '!'");
    expect(filter.sql).toContain("account LIKE ? ESCAPE '!'");
    expect(filter.sql).toContain("notes LIKE ? ESCAPE '!'");
    expect(filter.params).toEqual([7, "%vultr%", "%vultr%", "%vultr%", "%vultr%"]);
  });

  test("drops the search clause when the term is blank", () => {
    const filter = buildVaultFilter(7, "   ");
    expect(filter.sql).toBe("user_id = ?");
    expect(filter.params).toEqual([7]);
  });
});

describe("page window", () => {
  test("first page of three", () => {
    expect(pageWindow(58, 1, 20)).toEqual({ page: 1, offset: 0, totalPages: 3, from: 1, to: 20 });
  });

  test("last page is partial", () => {
    expect(pageWindow(58, 3, 20)).toEqual({ page: 3, offset: 40, totalPages: 3, from: 41, to: 58 });
  });

  test("clamps out-of-range requests", () => {
    expect(pageWindow(58, 99, 20).page).toBe(3);
    expect(pageWindow(58, 0, 20).page).toBe(1);
    expect(pageWindow(58, Number.NaN, 20).page).toBe(1);
  });

  test("empty result still has one page", () => {
    expect(pageWindow(0, 2, 20)).toEqual({ page: 1, offset: 0, totalPages: 1, from: 0, to: 0 });
  });
});
