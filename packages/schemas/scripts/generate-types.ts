/**
 * Reads every .avsc file in src/avro/ and emits a TypeScript interface into
 * src/generated/.  The mapping rules:
 *
 *   Avro "string"            → string
 *   Avro "int" | "long"      → number
 *   Avro "boolean"           → boolean
 *   Avro ["null", T]         → T | null
 *   Avro {type:"map",…}      → Record<string, V>
 *   Avro {type:"enum",…}     → union of string literals
 *   Avro {logicalType:…}     → number  (epoch millis stored as JS number)
 *
 * Run:  npx ts-node scripts/generate-types.ts
 */

import fs from "fs";
import path from "path";

const AVRO_DIR = path.resolve(__dirname, "../src/avro");
const OUT_DIR = path.resolve(__dirname, "../src/generated");

// ── Avro type → TypeScript type ───────────────────────────────────────────

type AvroSchema = {
  type: string;
  name?: string;
  namespace?: string;
  doc?: string;
  fields?: AvroField[];
  symbols?: string[];
  values?: AvroTypeRef;
  logicalType?: string;
};

type AvroTypeRef = string | AvroSchema | (string | AvroSchema)[];

type AvroField = {
  name: string;
  type: AvroTypeRef;
  doc?: string;
  default?: unknown;
};

function avroTypeToTs(avroType: AvroTypeRef, extraTypes: string[]): string {
  // Union — ["null", T] → T | null
  if (Array.isArray(avroType)) {
    const nonNull = avroType.filter((t) => t !== "null");
    const nullable = avroType.length !== nonNull.length;
    const inner = nonNull.map((t) => avroTypeToTs(t, extraTypes)).join(" | ");
    return nullable ? `${inner} | null` : inner;
  }

  // Primitive string aliases
  if (typeof avroType === "string") {
    const MAP: Record<string, string> = {
      string: "string",
      int: "number",
      long: "number",
      float: "number",
      double: "number",
      boolean: "boolean",
      bytes: "Buffer",
      null: "null",
    };
    return MAP[avroType] ?? avroType;
  }

  // Complex types
  if (avroType.logicalType) {
    // timestamp-millis / date → number (epoch ms)
    return "number";
  }

  if (avroType.type === "map") {
    const valType = avroTypeToTs(avroType.values!, extraTypes);
    return `Record<string, ${valType}>`;
  }

  if (avroType.type === "enum" && avroType.name && avroType.symbols) {
    const literal = avroType.symbols.map((s) => `"${s}"`).join(" | ");
    const typeDef = `export type ${avroType.name} = ${literal};\n`;
    if (!extraTypes.includes(typeDef)) extraTypes.push(typeDef);
    return avroType.name;
  }

  if (avroType.type === "record") {
    // Nested record — recurse (rare in this schema set)
    return avroType.name ?? "unknown";
  }

  return "unknown";
}

function generateInterface(schema: AvroSchema): string {
  const extraTypes: string[] = [];
  const lines: string[] = [];

  if (schema.doc) lines.push(`/** ${schema.doc} */`);
  lines.push(`export interface ${schema.name} {`);

  for (const field of schema.fields ?? []) {
    if (field.doc) lines.push(`  /** ${field.doc} */`);
    const tsType = avroTypeToTs(field.type, extraTypes);
    lines.push(`  ${field.name}: ${tsType};`);
  }

  lines.push(`}\n`);

  const header = [
    `// AUTO-GENERATED — run \`npm run generate\` to rebuild from ${schema.name ? schema.name.toLowerCase().replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`).replace(/^-/, "") : "schema"}.avsc`,
    `// DO NOT EDIT BY HAND`,
    ``,
  ].join("\n");

  return header + extraTypes.join("") + (extraTypes.length ? "\n" : "") + lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });

const avscFiles = fs.readdirSync(AVRO_DIR).filter((f) => f.endsWith(".avsc"));

for (const file of avscFiles) {
  const raw = fs.readFileSync(path.join(AVRO_DIR, file), "utf8");
  const schema: AvroSchema = JSON.parse(raw);

  if (schema.type !== "record" || !schema.name) {
    console.warn(`Skipping ${file}: not a top-level record`);
    continue;
  }

  const ts = generateInterface(schema);
  const outFile = path.join(OUT_DIR, `${schema.name}.ts`);
  fs.writeFileSync(outFile, ts, "utf8");
  console.log(`✓  ${file}  →  src/generated/${schema.name}.ts`);
}
