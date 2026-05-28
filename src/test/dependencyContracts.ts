import { createRequire } from "node:module";
import { Agent } from "@cursor/sdk";
import { createConnectTransport } from "@connectrpc/connect-node";

const require = createRequire(import.meta.url);

interface SqliteDatabase {
  run(sql: string, callback: (error: Error | null) => void): void;
  get<T>(sql: string, callback: (error: Error | null, row?: T) => void): void;
  close(callback: (error: Error | null) => void): void;
}

interface SqliteModule {
  Database: new (filename: string, callback?: (error: Error | null) => void) => SqliteDatabase;
}

const sqlite3 = require("sqlite3") as SqliteModule;

await verifySqliteOverride();
verifyConnectNodeOverride();
verifyCursorSdkImport();

console.log("dependency contracts passed");

async function verifySqliteOverride(): Promise<void> {
  const database = await openInMemoryDatabase();
  try {
    await run(database, "CREATE TABLE dependency_contract (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    await run(database, "INSERT INTO dependency_contract (value) VALUES ('ok')");
    const row = await get<{ value: string }>(database, "SELECT value FROM dependency_contract WHERE id = 1");
    if (row?.value !== "ok") throw new Error("sqlite3 override contract query returned an unexpected row.");
  } finally {
    await close(database);
  }
}

function verifyConnectNodeOverride(): void {
  const transport = createConnectTransport({ baseUrl: "http://127.0.0.1:1", httpVersion: "1.1" });
  if (!transport) throw new Error("connect-node transport did not initialize with the overridden undici package.");
}

function verifyCursorSdkImport(): void {
  if (typeof Agent.create !== "function") throw new Error("Cursor SDK Agent.create is unavailable.");
}

function openInMemoryDatabase(): Promise<SqliteDatabase> {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(":memory:", (error) => {
      if (error) reject(error);
      else resolve(database);
    });
  });
}

function run(database: SqliteDatabase, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    database.run(sql, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function get<T>(database: SqliteDatabase, sql: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    database.get<T>(sql, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function close(database: SqliteDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    database.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
