import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Builds one CREATE migration per dialect from migrations/snapshot.json.
 *
 * The shipped migrations only adopt tables that an older release already
 * created, so a fresh install has nothing to run. Reading the snapshot keeps
 * this change honest: the columns come from the plugin's own declared schema.
 */

const root = process.cwd();
const snapshot = JSON.parse(
  readFileSync(join(root, "migrations", "snapshot.json"), "utf8"),
);
const PREFIX = "p_ai_";

const TYPE = {
  sqlite: {
    varchar: (c) => "TEXT",
    text: () => "TEXT",
    integer: () => "INTEGER",
    timestamp: () => "TEXT",
    boolean: () => "INTEGER",
    real: () => "REAL",
    json: () => "TEXT",
  },
  mysql: {
    varchar: (c) => `VARCHAR(${c.length ?? 255})`,
    text: () => "TEXT",
    integer: () => "INT",
    timestamp: () => "DATETIME(3)",
    boolean: () => "TINYINT(1)",
    real: () => "DOUBLE",
    json: () => "TEXT",
  },
  postgres: {
    varchar: (c) => `VARCHAR(${c.length ?? 255})`,
    text: () => "TEXT",
    integer: () => "INTEGER",
    timestamp: () => "TIMESTAMP",
    boolean: () => "BOOLEAN",
    real: () => "DOUBLE PRECISION",
    json: () => "TEXT",
  },
};

function columnSql(dialect, name, column) {
  const type = TYPE[dialect][column.type] ?? (() => "TEXT");
  const parts = [`"${name}"`, type(column)];
  if (column.notNull) parts.push("NOT NULL");
  if (column.primaryKey) parts.push("PRIMARY KEY");
  return parts.join(" ");
}

function createTable(dialect, table, body) {
  const name = `${PREFIX}${table}`;
  if (dialect === "mysql") {
    return `CREATE TABLE IF NOT EXISTS ${name} (\n  ${body}\n);\n`;
  }
  return `CREATE TABLE IF NOT EXISTS "${name}" (\n  ${body}\n);\n`;
}

for (const dialect of ["sqlite", "mysql", "postgres"]) {
  const statements = [
    "-- ai 0001: create every table this plugin owns.",
    "-- Generated from migrations/snapshot.json so a fresh install has a schema.",
    "",
  ];
  for (const [table, definition] of Object.entries(snapshot.tables)) {
    const columns = Object.entries(definition.columns ?? {}).map(([name, column]) =>
      columnSql(dialect, name, column),
    );
    statements.push(createTable(dialect, table, columns.join(",\n  ")));
    for (const index of definition.indexes ?? []) {
      const name = index.name ?? `idx_${PREFIX}${table}_${index.columns.join("_")}`;
      const create = index.unique ? "CREATE UNIQUE INDEX" : "CREATE INDEX";
      statements.push(
        `${create} IF NOT EXISTS "${name}" ON "${PREFIX}${table}" (${index.columns
          .map((column) => `"${column}"`)
          .join(", ")});\n`,
      );
    }
  }
  const dir = join(root, "migrations", dialect);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "0001_create_tables.sql"), statements.join("\n"), "utf8");
}

console.log(
  `tables: ${Object.keys(snapshot.tables).length}, wrote 0001_create_tables.sql for 3 dialects`,
);
