import { AST } from "../grammar/parse.js";

class Num {
	constructor(value) {
		this.value = value;
	}
	equals(other) {
		return other instanceof Num && other.value === this.value;
	}
	toString() {
		return this.value.toString();
	}
}

class Bool {
	static T = new Bool(true);
	static F = new Bool(false);
	constructor(value) {
		this.value = value;
	}
	equals(other) {
		return other instanceof Bool && other.value === this.value;
	}
	toString() {
		return this.value.toString();
	}
}

class Var {
	constructor(name, type) {
		this.name = name;
		this.type = type;
	}
	toDecl() {
		const { name, type } = this;

		if (type instanceof FnType)
			return smt(
				"declare-fun", name,
				smt(...type.params.map(
					param => param.toSMT()
				)),
				type.result.toSMT()
			);
			
		return smt(
			"declare-const", name,
			type.toSMT()
		);
	}
	toString() {
		return this.name;
	}
}

class Fn {
	constructor(impl) {
		this.impl = impl;
	}
	call(args) {
		return this.impl(...args);
	}
	toString() {
		return "fn";
	}
}

class Tuple {
	constructor(type, items) {
		this.type = type;
		this.items = items;
	}
	toString() {
		return smt(this.type.id, ...this.items).toString();
	}
}

class LispExpr {
	constructor(op, args) {
		this.op = op;
		this.args = args;
	}
	toString() {
		const args = this.args.map(arg => arg.toString());
		if (args.every(arg => !arg.includes("(")))
			return `(${[this.op, ...this.args].join(" ")})`;

		const content = args
			.join("\n")
			.split("\n")
			.map(line => ` ${line}`)
			.join("\n");
		return `(${this.op}\n${content}\n)`;
	}
}

const fold = (params, result, fn) => {
	return (...args) => {
		if (params.length !== args.length)
			return null;
	
		if (!args.every((arg, i) => arg instanceof params[i]))
			return null;
		
		return new result(fn(...args.map(arg => arg.value)));
	}
};

const short = (check = (...args) => args[0], result = (...args) => args[0]) => {
	return (...args) => {
		return check(...args) ? result(...args) : null;
	};
};

const chain = (...fns) => {
	return (...args) => {
		for (const fn of fns) {
			const result = fn(...args);
			if (result) return result;
		}
		return null;
	};
};

const compare = fn => fold([Num, Num], Bool, fn);
const math = fn => fold(new Array(fn.length).fill(Num), Num, fn);
const logical = unit => (...args) => {
	if (args.length !== 2) return null;
	const [a, b] = args;

	if (unit.equals(a)) return b;
	if (unit.equals(b)) return a;

	const short = new Bool(!unit.value);
	if (short.equals(a)) return a;
	if (short.equals(b)) return b;

	return null;
};

const OPERATORS = {
	"+": math((a, b) => a + b),
	"-": chain(
		math((a, b) => a - b),
		math(a => -a)
	),
	"*": math((a, b) => a * b),
	"/": math((a, b) => a / b),
	"%": math((a, b) => a % b),
	"^": math((a, b) => a ** b),
	"<": compare((a, b) => a < b),
	">": compare((a, b) => a > b),
	"<=": compare((a, b) => a <= b),
	">=": compare((a, b) => a >= b),
	"=": compare((a, b) => a === b),
	"!=": compare((a, b) => a !== b),
	"and": logical(Bool.T),
	"or": logical(Bool.F),
	"not": chain(
		fold([Bool], Bool, a => !a)
	),
	"=>": chain(
		short((p, q) => Bool.F.equals(p) || Bool.T.equals(q), () => Bool.T),
		short((p, q) => Bool.T.equals(p), (p, q) => q)
	),
	"distinct": (...args) => {
		if (!args.every(arg => (
			arg instanceof Num ||
			arg instanceof Bool
		))) return null;

		return new Bool(new Set(args.map(arg => arg.value)).size === args.length);
	}
};

function smt(op, ...args) {
	if (/^_\d+$/.test(op) && args.length === 1 && args[0] instanceof Tuple)
		return args[0].items[op.slice(1) - 1];
	return OPERATORS[op]?.(...args) ?? new LispExpr(op, args);
}

function* enumerate(dims, size) {
	if (!dims) {
		yield [];
		return;
	}

	for (let i = 0; i < size; i++)
		for (const rest of enumerate(dims - 1, size))
			yield [i, ...rest];
}

const AGGREGATES = {
	distinct: null,
	sum: "+",
	or: "or",
	and: "and"
};

class Type { }

class LiteralType extends Type {
	constructor(name) {
		super();
		this.name = name;
	}
	toSMT() {
		return this.name;
	}
	toString() {
		return this.name;
	}
}

class TupleType extends Type {
	constructor(factors) {
		super();
		this.id = `_tuple_${Math.random().toString(36).slice(2)}`;
		this.factors = factors;
	}
	toSMT() {
		return this.id;
	}
	toDecl() {
		return smt(
			"declare-datatype", this.id,
			smt(
				smt(
					this.id,
					...this.factors.map(
						(type, i) => smt(
							`_${i + 1}`,
							type.toSMT()
						)
					)
				)
			)
		);
	}
	toString() {
		return this.id;
	}
}

class FnType extends Type {
	constructor(params, result) {
		super();
		this.params = params;
		this.result = result;
	}
	toSMT() {
		return null;
	}
	toString() {
		return `(${this.params.join(", ")}) -> ${this.result}`;
	}
}

class Scope {
	constructor(parent) {
		this.parent = parent;
		this.strong = true;
		this.vars = new Map();
	}
	*[Symbol.iterator]() {
		yield* this.vars.values();
		if (this.parent) yield* this.parent;
	}
	*entries() {
		yield* this.vars;
		if (this.parent) yield* this.parent.entries();
	}
	has(name) {
		return this.vars.has(name) ?? this.parent?.has(name);
	}
	get(name) {
		return this.vars.get(name) ?? this.parent?.get(name);
	}
	set(name, value) {
		if (this.strong) {
			this.vars.set(name, value);
		} else {
			this.parent?.set(name, value);
		}
	}
}

class Evaluator {
	constructor(inputs, print) {
		this.inputs = inputs;
		this.logic = null;
		this.shown = new Set();
		this.vars = new Scope(null, true);
		this.scope = this.vars;
		this.defaultType = new LiteralType("Int");
		this.types = new Set();
		this.print = print;

		this.push();
		this.assign("InputCount", new Num(inputs.length));
		for (let i = 0; i < inputs.length; i++)
			this.assign(`Input_${i + 1}`, new Num(inputs[i]));
		this.assign("Sqrt", this.numeric(x => Math.sqrt(x)));
		this.assign("Min", this.numeric((a, b) => Math.min(a, b)));
		this.assign("Max", this.numeric((a, b) => Math.max(a, b)));
	}
	push() {
		this.scope = new Scope(this.scope);
	}
	pop() {
		this.scope = this.scope.parent;
	}
	assign(name, value) {
		this.scope.set(name, value);
	}
	number(node) {
		const result = this.visit(node);
		if (!(result instanceof Num))
			node.error(`Must be constant number, got '${result}' instead`);

		return result;
	}
	bool(node) {
		const result = this.visit(node);
		if (!(result instanceof Bool))
			node.error(`Must be constant boolean, got '${result}' instead`);

		return result;
	}
	range(node) {
		const lo = this.number(node.lo).value;
		const hi = this.number(node.hi).value;

		if (!Number.isInteger(lo) || !Number.isInteger(hi))
			node.error(`Range bounds must be integers, got [${lo}, ${hi}]`);

		return [lo, hi];
	}
	getName(name) {
		const indices = name.indices.map(inx => this.number(inx).value);
		return [name.name, ...indices].join("_");
	}
	lookup(name) {
		const result = this.scope.get(name);
		if (result) return result;

		const v = new Var(name, this.defaultType);
		this.vars.set(name, v);
		return v;
	}
	visit(node) {
		if (!(node.constructor.name in this))
			node.error(`Missing '${node.constructor.name}'`);

		const result = this[node.constructor.name](node);

		if (result instanceof Type)
			this.types.add(result);

		return result;
	}
	and(node, values) {
		const real = values.filter(Boolean);

		if (!real.length)
			return null;
			// node.error(`Cannot AND together 0 items`);

		return real.reduce((a, b) => smt("and", a, b));
	}
	or(node, values) {
		const real = values.filter(Boolean);

		if (!real.length)
			return Bool.F;

		return real.reduce((a, b) => smt("or", a, b));
	}
	evalScope(node, strong) {
		this.push();
		this.scope.strong = strong;
		const bools = node.stmts.map(stmt => this.visit(stmt));
		this.pop();
		return this.and(node, bools);
	}
	forEachInRange(range, body) {
		const [lo, hi] = this.range(range);

		const size = hi - lo + 1;

		const names = this.visit(range.vars);
		for (const option of enumerate(names.length, size)) {
			this.push();
			for (let i = 0; i < option.length; i++)
				this.assign(names[i], new Num(option[i] + lo));
			this.scope.strong = false;
			body();
			this.pop();
		}
	}
	ListLike(list, handle) {
		return list.pieces
			.flatMap(piece => {
				if (!AST.match(piece, "Variadic"))
					return [handle(piece)];

				const names = [];
				this.forEachInRange(piece.range, () => {
					names.push(handle(piece.body));
				});
				return names;
			});
	}
	ReferenceList(list) {
		return this.ListLike(list, piece => this.getName(piece));
	}
	ExpressionList(list) {
		return this.ListLike(list, piece => this.visit(piece));
	}
	TypeList(list) {
		return this.ListLike(list, piece => this.visit(piece));
	}
	Index(node) {
		const index = this.number(node.index).value;
		if (!Number.isInteger(index) || index < 1)
			node.error(`Invalid tuple index '${index}'`);

		return smt(
			`_${index}`,
			this.visit(node.tuple)
		);
	}
	Binary(node) {
		const left = this.visit(node.left);
		const right = this.visit(node.right);
		const op = {
			"!=": "distinct"
		}[node.op] ?? node.op;

		return smt(op, left, right);
	}
	Logic(node) {
		const left = this.visit(node.left);

		if (left instanceof Bool) {
			if (node.op === "or")
				return left.value ? left : this.visit(node.right);
			
			if (node.op === "and")
				return left.value ? this.visit(node.right) : left;
		}

		return this.Binary(node);
	}
	Sum(node) {
		return this.Binary(node);
	}
	Product(node) {
		return this.Binary(node);
	}
	New(node) {
		const type = this.visit(node.type);
		const args = this.visit(node.args);
		if (!(type instanceof TupleType))
			node.error(`Cannot construct non-tuple type '${type}'`);

		if (type.factors.length !== args.length)
			node.error(`Wrong number of tuple factors. Expected ${type.factors.length}, got ${args.length}`);

		return new Tuple(type, args);
	}
	Reference(node) {
		return this.lookup(this.getName(node));
	}
	Call(node) {
		const fn = this.visit(node.fn);
		const args = this.visit(node.args);

		try {
			if (fn instanceof Fn)
				return fn.call(args);
			
			if (
				fn instanceof Var && 
				fn.type instanceof FnType
			) {
				this.checkParams(fn.type.params.length, args.length);
				return smt(fn, ...args);
			}

			node.error(`Cannot call non-function`);
		} catch (err) {
			if (typeof err === "string")
				node.error(err);

			throw err;
		}
	}
	Aggregate(node) {
		const result = [];
		this.forEachInRange(node.range, () => {
			result.push(this.visit(node.body));
		});

		if (!result.length)
			node.error(`Cannot use an empty aggregate`);

		const op = AGGREGATES[node.type];

		if (op) return result.reduce((a, b) => smt(op, a, b));

		return smt(node.type, ...result);
	}
	Prefix(node) {
		const op = {
			"-": "-",
			"~": "not"
		}[node.op];

		return smt(op, this.visit(node.target));
	}
	Implies(node) {
		const premise = this.visit(node.left);
		if (Bool.F.equals(premise))
			return Bool.T;
		const body = this.visit(node.right);
		if (!body) return null;
		return smt("=>", premise, body);
	}
	Power(node) {
		return this.Binary(node);
	}
	Compare(node) {
		const values = node.values.map(value => this.visit(value));
		if (values.length === 1) return values[0];

		const compares = [];
		for (let i = 0; i < values.length - 1; i++) {
			const a = values[i];
			const b = values[i + 1];
			const op = node.ops[i];

			compares.push(smt(op, a, b));
		}

		return this.and(node, compares);
	}
	Number(node) {
		return new Num(+node.value);
	}
	Bool(node) {
		return new Bool(node.value === "true");
	}
	Loop(node) {
		const forall = node.type === "for";

		if (node.range instanceof AST.FiniteRange) {
			const result = [];
			this.forEachInRange(node.range, () => {
				result.push(this.visit(node.body));
			});
			return forall ? this.and(node, result) : this.or(node, result);
		}

		const domain = this.visit(node.range.type);
		const vars = this.visit(node.range.vars);
		this.push();
		for (const name of vars)
			this.assign(name, new Var(name, domain));
		const body = this.visit(node.body);
		this.pop();

		if (!body) return null;

		return smt(forall ? "forall" : "exists", smt(
			...vars.map(name => smt(name, domain.toSMT()))
		), body);
	}
	VarDeclare(node) {
		const name = this.getName(node.name);
		if (name === "default") {
			this.defaultType = this.visit(node.type);
		} else {
			this.vars.set(
				name, new Var(name, this.visit(node.type))
			);
		}
	}
	numeric(fn) {
		return new Fn((...args) => {
			this.checkParams(fn.length, args.length);

			if (!args.every(arg => arg instanceof Num))
				throw `All arguments to built-in functions must be numeric, got: ${args.join(", ")}`;

			return new Num(fn(...args.map(arg => arg.value)));
		});
	}
	checkParams(params, args) {
		if (args !== params)
			throw `Wrong number of arguments. Expected ${params}, got ${args}`;
	}
	Fn(node) {
		const params = this.visit(node.params);
		const closure = this.scope;

		return new Fn((...args) => {
			this.checkParams(params.length, args.length);

			const oldScope = this.scope;
			this.scope = closure;
			this.push();
			for (let i = 0; i < args.length; i++)
				this.assign(params[i], args[i]);
			
			const result = this.visit(node.body);
			this.scope = oldScope;
			return result;
		});
	}
	TypeReference(node) {
		const result = this.lookup(this.getName(node));
		if (!(result instanceof Type))
			node.error(`Cannot refer to non-type value of kind '${result.constructor.name}' in a type context`);

		return result;
	}
	FnType(node) {
		return new FnType(
			this.visit(node.params),
			this.visit(node.result)
		);
	}
	Show(node) {
		this.shown.add(this.getName(node.ref));
	}
	Print(node) {
		this.print(
			this.visit(node.args).join(", "),
			node.lineNumber ?? "unknown"
		);
	}
	LiteralType(node) {
		return new LiteralType(node.name);
	}
	TupleType(node) {
		const factors = this.visit(node.factors)
			.map(type => {
				if (type instanceof FnType)
					factor.error(`Cannot create a tuple with a function type factor '${type}'`);
				return type;
			});
		
		return new TupleType(factors);
	}
	Assign(node) {
		this.assign(this.getName(node.name), this.visit(node.value));
	}
	TypeDeclare(node) {
		this.assign(this.getName(node.name), this.visit(node.type));
	}
	Block(node) {
		return this.evalScope(node, !node.weak);
	}
	SetLogic(node) {
		this.logic = node.id.join("_");
	}
	root(node) {
		const assertion = this.evalScope(node, true);
		
		if (this.logic === null)
			node.error(`Missing logic declaration`);

		const typeDecls = [...this.types]
			.filter(type => type instanceof TupleType)
			.map(tuple => tuple.toDecl());

		const varDecls = [...this.vars]
			.map(v => v.toDecl());

		return {
			smtlib: [
				smt("set-logic", this.logic),
				smt("set-option", ":produce-models", "true"),
				...typeDecls,
				...varDecls,
				...(assertion ? [smt("assert", assertion)] : []),
				smt("check-sat"),
				smt("get-model")
			].join("\n"),
			shown: [...this.shown]
		};
	}
}

export function evaluate(root, inputs, print) {
	const evaluator = new Evaluator(inputs, print);
	return evaluator.visit(root);
}