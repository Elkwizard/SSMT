import { AST, parse } from "../grammar/parseSMT.js"

export function summarize(result, shown) {
	if (result.startsWith("unsat")) {
		console.error("Unsatisfiable");
		return false;
	}

	try {
		if (!shown.length) {
			console.log(result);
		} else {
			const tree = parse(result.replace(/^\s*sat\s*/, ""));

			const nameToValue = new Map();
			tree.forEach(AST.Expr, ({ items }) => {
				if (
					items &&
					items[0].value === "define-fun" &&
					shown.includes(items[1].value)
				) {
					nameToValue.set(items[1].value, items[4]);
				}
			});

			const show = term => {
				if (term.value)
					return term.value.replace(/\.0*$/, "");

				if (term.items[0].value === "/")
					return `${show(term.items[1])}/${show(term.items[2])}`;

				if (term.items[0].value === "-")
					return `-${show(term.items[1])}`;

				if (term.items[0].value.includes("_tuple"))
					return `(${term.items.slice(1).map(show).join(", ")})`;

				return `<unknown>(${term.toString()})`;
			};

			for (const name of shown) {
				const value = nameToValue.get(name);
				console.log(`${name} = ${show(value)}`);
			}
		}
	} catch (err) {
		console.error(err);
		console.log(result);
	}

	return true;
}