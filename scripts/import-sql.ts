/**
 * Print one SQL script that loads the 2026 season and then lists any mismatch
 * with the sheet. No database password.
 *
 *   npm run import:sql > import.sql
 */
import path from "node:path";
import { buildImportSql } from "./lib/importSql.ts";
import { loadExport } from "./lib/parseExport.ts";

const exported = loadExport(path.resolve(process.env.PICKEM_DATA ?? "data/2026"));
process.stdout.write(buildImportSql(exported));
