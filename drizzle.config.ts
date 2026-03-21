import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.QNP_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://nanoclaw:nanoclaw@localhost:5432/nanoclaw",
  },
});
