import { clean } from "../core/clean.js";
import { evaluate } from "../core/evaluate.js";
import { parse } from "../grammar/parse.js";

postMessage({ type: "load" });

addEventListener("message", event => {
	const { ssmt, inputs } = event.data;
	try {
		const root = clean(parse(ssmt));
		const { smtlib } = evaluate(root, inputs);
		postMessage({
			type: "success",
			smtlib
		});
	} catch (err) {
		postMessage({
			type: "error",
			error: err
		});
	}
});