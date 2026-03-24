import { describe, expect, it } from "vitest";
import { readMysqlInsertId } from "./db";

describe("readMysqlInsertId", () => {
  it("reads insertId from mysql2 tuple [ResultSetHeader, fields]", () => {
    const id = readMysqlInsertId([
      { insertId: 42, affectedRows: 1, warningStatus: 0 },
      [],
    ]);
    expect(id).toBe(42);
  });

  it("reads bigint insertId", () => {
    const id = readMysqlInsertId([{ insertId: BigInt(99), affectedRows: 1, warningStatus: 0 }, []]);
    expect(id).toBe(99);
  });

  it("reads insertId from a bare ResultSetHeader-shaped object", () => {
    expect(readMysqlInsertId({ insertId: 7, affectedRows: 1, warningStatus: 0 })).toBe(7);
  });

  it("throws when insertId missing or invalid", () => {
    expect(() => readMysqlInsertId([{}, []])).toThrow(/Could not read insertId/);
    expect(() => readMysqlInsertId(null)).toThrow(/Could not read insertId/);
  });
});
