import { AST } from "../grammar/parse.js"
const { make } = AST;

AST.prototype.toString = () => "";

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

	return root;
}