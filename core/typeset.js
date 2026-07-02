import { AST } from "../grammar/parse.js";

const tex = String.raw;
const makeTexLines = lines => lines.join("\\\\\n");

class Typesetter {
	constructor() {

	}
	visit(node) {
		if (!(node.constructor.name in this))
			node.error(`Missing '${node.constructor.name}'`);

		return this[node.constructor.name](node);
	}
	Reference(node) {
		let name = node.name;
		if (name.length > 1)
			name = tex`\text{${name}}`;
		if (!node.indices.length)
			return name;
		return `${name}_{${node.indices.map(inx => this.visit(inx)).join(",")}}`
	}
	UserReference(node) {
		return this.Reference(node);
	}
	SysReference(node) {
		return this.Reference(node);
	}
	Call(node) {
		const operations = {
			Sqrt: x => tex`\sqrt{${x}}`
		}
		const args = node.args.map(arg => this.visit(arg));
		if (
			node.fn instanceof AST.SysReference &&
			node.fn.name in operations &&
			!node.fn.indices.length
		) {
			return operations[node.fn.name](...args);
		}

		return tex`${this.visit(node.fn)}(${args.join(", ")})`;
	}
	Equality(node) {
		const op = {
			"=": "=",
			"<=": "\\leq",
			">=": "\\geq",
			"<": "<",
			">": ">",
			"!=": "\\neq"
		}[node.op];
		return tex`${this.visit(node.left)} &${op} ${this.visit(node.right)}`;
	}
	Logic(node) {
		return tex`\text{Using logic ${node.id}}`;
	}
	FnType(node) {
		return tex`${node.params.map(param => this.visit(param)).join(tex` \times `)} \to ${this.visit(node.result)}`;
	}
	VarRange(range) {
		const lo = this.visit(range.lo);
		const hi = this.visit(range.hi);

		const vars = range.vars.map(v => this.visit(v)).join(", ");

		return tex`${vars}\in [${lo}, ${hi}]`;
	}
	Binary(node) {
		const left = this.visit(node.left);
		const right = this.visit(node.right);
		if (node.op === "/")
			return `\frac{${left}}{${right}}`;
		if (node.op === "*")
			return `(${left})(${right})`;
		return `${left} ${node.op} ${right}`; 
	}
	Show(node) {
		return "";
	}
	Sum(node) {
		return this.Binary(node);
	}
	Product(node) {
		return this.Binary(node);
	}
	Aggregate(node) {
		const symbol = {
			distinct: tex`\text{distinct }`,
			sum: tex`\sum`
		}[node.type];
		return `${symbol}_{${this.visit(node.range)}} ${this.visit(node.body)}`;
	}
	Literal(node) {
		return node.value;
	}
	Block(block) {
		return block.stmts
			.map(stmt => this.visit(stmt))
			.join(", ");
	}
	getStatements(stmt) {
		if (stmt instanceof AST.Block)
			return stmt.stmts.flatMap(stmt => this.getStatements(stmt));
		return [stmt];
	}
	Loop(node) {
		const body = this.visit(node.body);
		if (!body) return "";

		const stmts = this.getStatements(node.body)
			.map(stmt => this.visit(stmt))
			.filter(Boolean)
			.map(stmt => {
				return tex`\forall ${this.visit(node.range)}: ${stmt}`;
			});

		return makeTexLines(stmts);
	}
	LiteralType(node) {
		return tex`\mathbb{${{
			Int: "Z",
			Real: "R",
			Bool: "B"
		}[node.name]}}`;
	}
	Declare(node) {
		if (node.name.name === "default" && !node.name.indices.length)
			return tex`\text{Working in $${this.visit(node.type)}$}`
		return tex`${this.visit(node.name)} &\in ${this.visit(node.type)}`;
	}
	root(node) {
		const assertions = node.stmts
			.map(stmt => this.visit(stmt))
			.filter(Boolean);

		return tex`
			\documentclass[12pt]{article}
			\usepackage{amsmath}
			\usepackage{amssymb}
			\begin{document}
				\begin{align*}
					${makeTexLines(assertions)}
				\end{align*}
			\end{document}
		`;
	}
}

export function typeset(node) {
	const typesetter = new Typesetter();
	return typesetter.visit(node);
}