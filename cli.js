import fs from "node:fs";
import path from "node:path";
import child_process from "node:child_process";
import { AST, parse } from "./grammar/parse.js"
import { clean } from "./core/clean.js";
import { evaluate } from "./core/evaluate.js";
import { fileURLToPath } from "node:url";
import { typeset } from "./core/typeset.js";
import { AST as SMT, parse as parseSMT } from "./grammar/parseSMT.js";
import { parseArgs } from "node:util";
import { summarize } from "./core/summarize.js";

const {
	positionals: [file, ...inputs],
	values: { solver }
} = parseArgs({
	options: {
		solver: {
			type: "string",
			short: "s",
			default: path.join(
				path.dirname(fileURLToPath(import.meta.url)),
				"../solve.sh"
			)
		}
	},
	allowPositionals: true
});

const content = fs.readFileSync(file, "utf-8");

const root = clean(parse(content));
const { smtlib, shown } = evaluate(
	root, inputs.map(input => +input),
	(msg, loc) => console.log(`line ${loc} | print: ${msg}`)
);
const outPath = file.replace(/\.ssmt$/, ".smt2");

fs.writeFileSync(outPath, smtlib, "utf-8");

console.log("COMPILED");

const { stdout } = child_process.spawnSync("bash", [solver, path.resolve(outPath)]);
const result = stdout.toString();

process.exit(summarize(result, shown) ? 0 : 1);