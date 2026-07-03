import { AST } from "../grammar/parse.js"
const { make } = AST;

AST.prototype.toString = () => "";

const expandSubscriptRanges = root => {
	root.transform("Variadic", node => {
		if (!("name" in node)) return node;

		const { name, lo, hi } = node;

		const result = make[node.constructor.name](
			make.FiniteRange(
				make.ReferenceList([
					make.Reference("$", [])
				]),
				lo, hi
			),
			make.Reference(name, [make.Reference("$", [])])
		).from(node);

		return result;
	});
};

export function clean(root) {
	root.forEach([AST.Block, AST.root], node => {
		node.stmts ??= [];
	});
	root.forEach("Reference", node => {
		node.indices ??= [];
	});

	root = root.transform(AST.Term, node => {
		const { base, step } = node;
		switch (step.constructor) {
			case AST.IndexSuffix:
				return make.Index(base, step.index).from(node);
			case AST.CallSuffix:
				return make.Call(base, step.args).from(node);
		}
	});

	expandSubscriptRanges(root);

	AST.debugRoot = root;

	return root;
}