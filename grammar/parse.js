class AST {
	static REPLACE_KEY = Symbol("replace");
	static START_KEY = Symbol("start");
	static END_KEY = Symbol("end");
	static TOKENS_KEY = Symbol("tokens");
	
	#textContent;

	constructor(startIndex) {
		this[AST.START_KEY] = startIndex;
	}

	set textContent(value) {
		this.#textContent = value;
	}

	get textContent() {
		if (this.#textContent === undefined) {
			const { START_KEY, END_KEY, TOKENS_KEY } = AST;
			if (!(START_KEY in this && END_KEY in this && TOKENS_KEY in this))
				return "";
			const start = this[TOKENS_KEY][this[START_KEY]];
			const end = this[TOKENS_KEY][this[END_KEY]];
			this.#textContent = start.source.slice(
				start.position,
				end.position + end.content.length
			);
		}

		return this.#textContent;
	}

	get children() {
		return this.constructor.labels
			.flatMap(label => {
				const child = this[label];
				if (child === undefined) return [];
				return Array.isArray(child) ? child : [child];
			})
			.filter(node => node instanceof AST);
	}

	get lineNumber() {
		return this[AST.TOKENS_KEY]?.[this[AST.START_KEY]]?.lineNumber ?? -1;
	}

	error(message) {
		const tokens = this[AST.TOKENS_KEY];
		
		const startToken = tokens?.[this[AST.START_KEY]];
		const endToken = tokens?.[this[AST.END_KEY]]
		if (startToken) {
			startToken.error(message, endToken, this.toString());
			return true;
		}

		if (AST.debugRoot) {
			const parentKey = Symbol("parent");
			
			AST.debugRoot.forEach(AST, node => {
				for (const child of node.children)
					if (child instanceof AST)
						child[parentKey] = node;
			});
			
			let node = this;
			while (node && node[AST.TOKENS_KEY]?.[node[AST.START_KEY]] === undefined)
				node = node[parentKey];

			if (node) node.error(message);
		}
		
		throw new Error(`At '\x1b[41m${this}\x1b[0m':\n\n${message}`);
	}

	finalize(tokens) {
		const { REPLACE_KEY, TOKENS_KEY } = AST;

		const { replace } = this;
		if (replace) return replace;

		const replacement = this[REPLACE_KEY];
		if (replacement && !Object.keys(this).length)
			return replacement;

		this[TOKENS_KEY] = tokens;
		return this;
	}

	setProperty(node, value, index) {
		const { REPLACE_KEY, END_KEY } = AST;
		const key = node.label ?? REPLACE_KEY;

		const current = this[key];
		if (current !== undefined) {
			if (key === REPLACE_KEY) this[REPLACE_KEY] = null;
			else current.push(value);
		} else this[key] = node.repeated ? [value] : value;

		this[END_KEY] = index;
	}

	removeMetadata() {
		AST.removeMetadata(this);
		return this;
	}

	copy(copyMetadata) {
		return AST.copy(this, copyMetadata);
	}

	shallowCopy() {
		return Object.assign(new this.constructor(), this);
	}

	clear() {
		for (const key in this)
			delete this[key];
	}
	
	from(node, endNode = node) {
		this[AST.TOKENS_KEY] = node[AST.TOKENS_KEY];
		this[AST.START_KEY] = node[AST.START_KEY];
		this[AST.END_KEY] = endNode[AST.END_KEY];
		
		return this;
	}

	transformAll(transf) {
		return AST.transformAll(this, transf);
	}

	transform(match, transf) {
		return this.transformAll(
			node => AST.match(node, match) ? transf(node) : node
		);
	}

	forAll(fn, afterFn) {
		AST.forAll(this, fn, afterFn);
	}

	forEach(match, fn, afterFn) {
		this.forAll(node => {
			if (AST.match(node, match))
				return fn(node);
		}, afterFn ? node => {
			if (AST.match(node, match))
				afterFn(node);
		} : undefined);
	}

	#getPrintKey(key, repeat) {
		const value = this[key];
		return repeat ? value?.[repeat.index] : value; 
	}

	#print(printer, repeat) {
		if (typeof printer === "string")
			return [printer];

		if (Array.isArray(printer)) {
			const result = [];
			for (const element of printer)
				result.push(...this.#print(element, repeat));
			return result;
		}

		if (printer.key) {
			const result = this.#getPrintKey(printer.key, repeat);
			if (repeat) repeat.value = result;

			if (result !== undefined && printer.type) {
				const Type = AST[printer.type];
				if (Type && !(result instanceof Type)) {
					const ast = new Type();
					ast.replace = result;
					return [ast];
				}
			}

			return [result ?? ""];
		}

		if (printer.options) {
			for (const option of printer.options)
				if (option[0].some(key => this[key]))
					return this.#print(option[1], repeat);
			for (const option of printer.options) {
				const { key, type } = option[1];
				const ast = AST[type];
				const value = this.#getPrintKey(key, repeat);
				if (value === undefined) continue;
				if (
					(!ast && typeof value === "string") ||
					(ast && ast.replacements.includes(value.constructor.name))
				) return this.#print(option[1], repeat);
			}
			return this.#print(printer.options.at(-1)[1], repeat);
		}

		if (printer.repeat) {
			const repeat = { index: 0, value: null };
			const result = [];
			while (true) {
				const step = this.#print(printer.repeat, repeat);
				if (repeat.value === undefined) break;

				if (repeat.index && printer.delimiter) {
					repeat.index--;
					result.push(...this.#print(printer.delimiter, repeat));
					repeat.index++;
				}

				result.push(...step);
				repeat.index++;
			}
			return result;
		}
	}

	joinStrings(strs) {
		return strs.join(" ");
	}

	toString() {
		return this.joinStrings(
			this.#print(this.constructor.printer).map(String)
		);
	}

	static make = new Proxy({}, {
		get(_, key) {
			const cls = AST[key];
			const { labels } = cls;

			return (...args) => {
				const result = new cls();
				delete result[AST.START_KEY];
				const count = Math.min(labels.length, args.length);
				for (let i = 0; i < count; i++) {
					const value = args[i];
					if (value !== undefined)
						result[labels[i]] = value;
				}
				return result;
			};
		}
	});

	static removeMetadata(node) {
		if (!AST.is(node)) return;
		if (Array.isArray(node)) {
			node.forEach(AST.removeMetadata);
		} else {
			const labels = new Set(node.constructor.labels);
			for (const key of Reflect.ownKeys(node)) {
				if (labels.has(key)) {
					AST.removeMetadata(node[key]);
				} else {
					delete node[key];
				}
			}
		}
	}

	static copy(node, copyMetadata = () => null, found = new Map()) {
		if (!AST.is(node)) {
			found.set(node, node);
			return node;
		}
		
		if (Array.isArray(node)) {
			const copy = [];
			found.set(node, copy);
			for (const element of node)
				copy.push(AST.copy(element, copyMetadata, found));
			return copy;
		}

		const result = new node.constructor();
		found.set(node, result);
		for (const label of node.constructor.labels) {
			const value = node[label];
			if (value !== undefined) result[label] = AST.copy(value, copyMetadata, found);
		}

		for (const key of [AST.START_KEY, AST.END_KEY, AST.TOKENS_KEY])
			result[key] = node[key];
		copyMetadata(node, result, ref => found.get(ref) ?? ref);

		return result;
	}

	static match(node, cls) {
		if (Array.isArray(cls)) return cls.some(one => AST.match(node, one));
		if (cls === AST || cls.prototype instanceof AST) return node instanceof cls;
		if (typeof cls === "string") return node.constructor.categories?.has?.(cls);
		return cls(node);
	}

	static is(value) {
		return Array.isArray(value) || value instanceof AST;
	}

	static keys(node) {
		return Array.isArray(node) ? node.keys() : node.constructor.labels;
	}

	static transformAll(node, transf) {
		const result = transf(node);
		if (result === false) return node;
		node = result;
		if (AST.is(node)) {
			if (Array.isArray(node)) {
				for (let i = 0; i < node.length; i++) {
					const child = node[i];
					if (child === undefined) continue;
					const result = AST.transformAll(child, transf);
					
					if (child === result) continue;

					if (result === undefined) {
						node.splice(i, 1);
						i--;
					} else if (Array.isArray(result)) {
						node.splice(i, 1, ...result);
						i += result.length - 1;
					} else {
						node[i] = result;
					}
				}
			} else {
				for (const key of AST.keys(node)) {
					const child = node[key];
					if (child === undefined) continue;
					const result = AST.transformAll(child, transf);
					node[key] = result;
				}
			}
		}
		return node;
	}

	static forAll(node, fn, afterFn) {
		if (fn(node) === false) return;
		if (AST.is(node)) {
			for (const key of AST.keys(node)) {
				const value = node[key];
				if (value === undefined) continue;
				AST.forAll(value, fn, afterFn);
			}
		}
		afterFn?.(node);
	}
}

const parse = (function () {
	AST.FiniteRange = class FiniteRange extends AST { static labels = ["vars","lo","hi"]; static categories = new Set([]); };
AST.UniversalRange = class UniversalRange extends AST { static labels = ["vars","type"]; static categories = new Set([]); };
AST.ReferenceLike = class ReferenceLike extends AST { static labels = ["name","indices"]; static categories = new Set([]); };
AST.TypeReference = class TypeReference extends AST { static labels = ["name","indices"]; static categories = new Set(["Type","Reference"]); };
AST.LiteralType = class LiteralType extends AST { static labels = ["name"]; static categories = new Set(["Type"]); };
AST.TupleType = class TupleType extends AST { static labels = ["factors"]; static categories = new Set(["Type"]); };
AST.SimpleType = class SimpleType extends AST { static labels = []; static categories = new Set(["Type"]); };
AST.FnType = class FnType extends AST { static labels = ["params","result"]; static categories = new Set(["Type"]); };
AST.Type = class Type extends AST { static labels = []; static categories = new Set(["Type"]); };
AST.AggregateType = class AggregateType extends AST { static labels = []; static categories = new Set([]); };
AST.CallSuffix = class CallSuffix extends AST { static labels = ["args"]; static categories = new Set([]); };
AST.IndexSuffix = class IndexSuffix extends AST { static labels = ["index"]; static categories = new Set([]); };
AST.Step = class Step extends AST { static labels = []; static categories = new Set([]); };
AST.Call = class Call extends AST { static labels = ["fn","args"]; static categories = new Set([]); };
AST.Index = class Index extends AST { static labels = ["tuple","index"]; static categories = new Set([]); };
AST.Reference = class Reference extends AST { static labels = ["name","indices"]; static categories = new Set(["Expression","Reference"]); };
AST.Nested = class Nested extends AST { static labels = ["replace"]; static categories = new Set(["Expression"]); };
AST.Number = class Number extends AST { static labels = ["value"]; static categories = new Set(["Expression"]); };
AST.Bool = class Bool extends AST { static labels = ["value"]; static categories = new Set(["Expression"]); };
AST.New = class New extends AST { static labels = ["type","args"]; static categories = new Set(["Expression"]); };
AST.Fn = class Fn extends AST { static labels = ["params","body"]; static categories = new Set(["Expression"]); };
AST.BaseExpression = class BaseExpression extends AST { static labels = []; static categories = new Set(["Expression"]); };
AST.Term = class Term extends AST { static labels = ["base","step"]; static categories = new Set(["Expression"]); };
AST.Aggregate = class Aggregate extends AST { static labels = ["type","range","body"]; static categories = new Set(["Expression"]); };
AST.Prefix = class Prefix extends AST { static labels = ["op","target"]; static categories = new Set(["Expression"]); };
AST.Product = class Product extends AST { static labels = ["left","op","right"]; static categories = new Set(["Expression"]); };
AST.Sum = class Sum extends AST { static labels = ["left","op","right"]; static categories = new Set(["Expression"]); };
AST.Compare = class Compare extends AST { static labels = ["left","op","right"]; static categories = new Set(["Expression"]); };
AST.Logic = class Logic extends AST { static labels = ["left","op","right"]; static categories = new Set(["Expression"]); };
AST.Implies = class Implies extends AST { static labels = ["left","op","right"]; static categories = new Set(["Expression"]); };
AST.Expression = class Expression extends AST { static labels = []; static categories = new Set(["Expression"]); };
AST.VarDeclare = class VarDeclare extends AST { static labels = ["name","type"]; static categories = new Set(["Declaration"]); };
AST.TypeDeclare = class TypeDeclare extends AST { static labels = ["name","type"]; static categories = new Set(["Declaration"]); };
AST.Declare = class Declare extends AST { static labels = []; static categories = new Set(["Declaration"]); };
AST.Loop = class Loop extends AST { static labels = ["range","body"]; static categories = new Set(["Statement"]); };
AST.SetLogic = class SetLogic extends AST { static labels = ["id"]; static categories = new Set(["Statement"]); };
AST.Show = class Show extends AST { static labels = ["ref"]; static categories = new Set(["Statement"]); };
AST.Assign = class Assign extends AST { static labels = ["name","value"]; static categories = new Set(["Statement"]); };
AST.Statement = class Statement extends AST { static labels = []; static categories = new Set(["Statement"]); };
AST.root = class root extends AST { static labels = ["stmts"]; static categories = new Set([]); };
AST.Block = class Block extends AST { static labels = ["weak","stmts"]; static categories = new Set(["Expression"]); };
	
	class ParseError {
		constructor(message, token, stack) {
			this.message = message;
			this.token = token;
			this.stack = stack;
		}
		show() {
			const stack = "\n" + this.stack.map(line => `\tat ${line}`).reverse().join("\n");
			if (this.token)
				this.token.error(`${this.message} (at '${this.token.content}')${stack}`);
			else throw new SyntaxError(this.message + stack);
		}
	}
	
	class Graph {
		constructor(name, start, end, nodes) {
			this.name = name;
			this.start = start;
			this.end = end;
			this.nodes = nodes;
		}
		preprocess() {
			this.astClass = AST[this.name];
			for (const node of this.nodes) {
				if (node.reference)
					if (!node.terminal) node.match = definitions[node.match];
				for (const key in node.typeChoices)
					node.typeChoices[key] = node.typeChoices[key].map(index => node.to[index]);
				for (const key in node.literalChoices)
					node.literalChoices[key] = node.literalChoices[key].map(index => node.to[index]);
			}
		}
		static hydrate({ nodes, start, end, name }) {
			for (const node of nodes)
				node.to = node.to.map(inx => nodes[inx]);
			
			return new Graph(name, nodes[start], nodes[end], nodes);
		}
	}
	
	class TokenStream {
		constructor(tokens) {
			this.all = tokens;
		}
		remove(type) {
			this.all = this.all.filter(tok => tok.type !== type);
		}
	}

	const { color, background, indent } = (() => {
	const FOREGROUND_OFFSET = 30;
	const BACKGROUND_OFFSET = 40;
	const COLOR_MAP = {
		"black": 0,
		"red": 1,
		"green": 2,
		"yellow": 3,
		"blue": 4,
		"magenta": 5,
		"cyan": 6,
		"light gray": 7,
		"dark gray": 60,
		"light red": 61,
		"light green": 62,
		"light yellow": 63,
		"light blue": 64,
		"light magenta": 65,
		"light cyan": 66,
		"white": 67
	};

	function normalize(text) {
		return text.replace(/\x1b\[[\d;]+\w/g, "");
	}
	
	function color(name, text) {
		const code = COLOR_MAP[name] + FOREGROUND_OFFSET;
		return `\x1b[${code}m${normalize(text)}\x1b[0m`;
	}

	function background(name, text) {
		const code = COLOR_MAP[name] + BACKGROUND_OFFSET;
		return `\x1b[${code}m${normalize(text)}\x1b[0m`;
	}
	
	function indent(str) {
		return str
			.split("\n")
			.map(line => "    " + line)
			.join("\n");
	}


	return { color, background, indent };
})();class Token {
	constructor(content, type, position = 0, source = content, filename) {
		this.content = content;
		this.type = type;
		this.position = position;
		this.source = source;
		this.filename = filename;
	}
	
	get location() {
		if (!this._location) {
			const before = this.source.slice(0, this.position);
			const line = (before.match(/\n/g)?.length ?? 0) + 1;
			const column = before.match(/.*$/)[0].length;
			this._location = { line, column, filename: this.filename };
		}

		return this._location;
	}
	
	get lineNumber() {
		return this.location.line;
	}

	plus(token, type) {
		return new Token(
			this.content + token.content,
			type ?? this.type,
			this.position,
			this.source
		);
	}

	error(message, endToken = null, currentContent = null) {
		endToken ??= this;
		
		const normalize = str => str.replace(/\x1b\[.*?[a-z]|\s*/ig, "");
		
		const prefix = this.source.slice(0, this.position);
		const suffix = this.source.slice(endToken.position + endToken.content.length);
		const sourceContent = this.source.slice(this.position, endToken.position + endToken.content.length);
		if (currentContent && normalize(currentContent) === normalize(sourceContent))
			currentContent = "";
		const akaMarker = currentContent ? " AKA " + background("blue", currentContent) : "";
		const content = background("red", sourceContent) + akaMarker;
		const newSource = prefix + content + suffix;
		const lines = newSource.split("\n");

		const indexOf = pos => {
			let index = 0;
			for (let i = 0; i < pos; i++)
				if (newSource[i] === "\n") index++;
			
			return index;
		};

		
		const startIndex = indexOf(this.position);
		const endIndex = indexOf(this.position + content.length);

		const firstShownIndex = Math.max(0, startIndex - 1);
		const endShownIndex = Math.min(lines.length, endIndex + 2);

		const excerptLines = lines.slice(
			firstShownIndex, endShownIndex
		);

		const lineNumbers = excerptLines.map((_, i) => String(i + firstShownIndex + 1));
		const maxWidth = lineNumbers.at(-1).length;

		const excerpt = excerptLines
			.map((line, i) => `${lineNumbers[i].padStart(maxWidth)} │ ${line}`)
			.join("\n")
			.replace(/\t/g, "    ");

		const barPrefix = "═".repeat(maxWidth + 1);
		const bar = "═".repeat(40);
		const lineBlock = `${barPrefix}╤${bar}\n${excerpt}\x1b[0m\n${barPrefix}╧${bar}`;
		const columnIndex = this.position - newSource.lastIndexOf('\n', this.position) - 1;
		const filename = this.filename ? `in ${this.filename}:\n` : "";
		const position = `${filename}line ${startIndex + 1}, column ${columnIndex + 1}:`;
		const output = `\n\n${lineBlock}\n${position}\n${message}`;
		throw new Error(output);
		// throw new SyntaxError(message + "\n\n" + excerpt);
	}

	toString() {
		return `(${this.type.toString()}: ${color("blue", this.content)})`;
	}
}class TokenStreamBuilder {
	constructor(source, filename) {
		this.source = source;
		this.filename = filename;
		this.index = 0;
		this.tokens = [];
	}

	get stream() {
		return new TokenStream(this.tokens);
	}

	append(content, type) {
		const position = this.source.indexOf(content, this.index);
		this.index = position + content.length;
		this.tokens.push(new Token(content, type, position, this.source, this.filename));
	}

	static regex(source, regexes, filename) {
		const builder = new TokenStreamBuilder(source, filename);

		tokenize: while (source.length) {
			for (let i = 0; i < regexes.length; i++) {
				const [regex, type, assert] = regexes[i];
				if (regex.test(source)) {
					const content = source.match(regex)[0];
					if (assert && !assert(content, builder.tokens)) continue;
					builder.append(content, type);
					source = source.slice(content.length);
					continue tokenize;
				}
			}

			if (source.length) throw new SyntaxError(`Tokenization failed at position ${builder.index}: '${source[0]}'`);
		}

		return builder.stream;
	}
}

	const regex = [[/^(?:\s+)/, "whitespace", null], [/^(?:\/\/.*)/, "comment", null], [/^(?:distinct|false|logic|Bool|Real|weak|true|type|show|Int|sum|new|and|for|on|fn|of|or|_)/, "keyword", null], [/^(?:\d+)/, "number", null], [/^(?:[^\W_]+)/, "id", null], [/^(?:,\s)/, "comma", null], [/^(?:\-\>|\!\=|\<\=|\>\=|\=\>|\:\=|\[|\]|\:|\,|\(|\)|\.|\{|\}|\-|\~|\*|\/|\%|\+|\=|\<|\>)/, "symbol", null]];
	const types = { };
	const hidden = new Set(["whitespace","comment"]);
	for (const pair of regex) {
		const name = pair[1];
		types[name] = { name, toString: () => name };
		pair[1] = types[name];
	}
	
	const { definitions, printers, replacements } = {"definitions":{"FiniteRange":{"nodes":[{"match":"Reference","reference":true,"to":[1,2],"label":"vars","enclose":false,"repeated":true,"typeChoices":{"comma":[0],"keyword":[1]},"literalChoices":{"on":[1]}},{"match":"comma","reference":true,"to":[0],"label":null,"enclose":false,"repeated":true,"terminal":true,"typeChoices":{"id":[0]},"literalChoices":{}},{"match":"on","reference":false,"to":[3],"label":null,"enclose":false,"typeChoices":{"symbol":[0]},"literalChoices":{"[":[0]}},{"match":"[","reference":false,"to":[4],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":"Expression","reference":true,"to":[5],"label":"lo","enclose":false,"typeChoices":{"comma":[0]},"literalChoices":{}},{"match":"comma","reference":true,"to":[6],"label":null,"enclose":false,"terminal":true,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":"Expression","reference":true,"to":[7],"label":"hi","enclose":false,"typeChoices":{"symbol":[0]},"literalChoices":{"]":[0]}},{"match":"]","reference":false,"to":[8],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"of":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":8,"name":"FiniteRange"},"UniversalRange":{"nodes":[{"match":"Reference","reference":true,"to":[1,2],"label":"vars","enclose":false,"repeated":true,"typeChoices":{"comma":[0],"symbol":[1]},"literalChoices":{":":[1]}},{"match":"comma","reference":true,"to":[0],"label":null,"enclose":false,"repeated":true,"terminal":true,"typeChoices":{"id":[0]},"literalChoices":{}},{"match":":","reference":false,"to":[3],"label":null,"enclose":false,"typeChoices":{"id":[0],"keyword":[0],"symbol":[0]},"literalChoices":{"Int":[0],"Bool":[0],"Real":[0],"(":[0]}},{"match":"Type","reference":true,"to":[4],"label":"type","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":4,"name":"UniversalRange"},"ReferenceLike":{"nodes":[{"match":"id","reference":true,"to":[1,4],"label":"name","enclose":false,"terminal":true,"typeChoices":{"keyword":[0]},"literalChoices":{"_":[0]}},{"match":"_","reference":false,"to":[2],"label":null,"enclose":false,"typeChoices":{"id":[0],"symbol":[0],"number":[0],"keyword":[0]},"literalChoices":{"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"weak":[0],"{":[0]}},{"match":"BaseExpression","reference":true,"to":[3,4],"label":"indices","enclose":false,"repeated":true,"typeChoices":{"symbol":[0]},"literalChoices":{",":[0]}},{"match":",","reference":false,"to":[2],"label":null,"enclose":false,"repeated":true,"typeChoices":{"id":[0],"symbol":[0],"number":[0],"keyword":[0]},"literalChoices":{"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"weak":[0],"{":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":4,"name":"ReferenceLike"},"TypeReference":{"nodes":[{"match":"id","reference":true,"to":[1,4],"label":"name","enclose":false,"terminal":true,"typeChoices":{"keyword":[0,1],"comma":[1],"symbol":[1],"id":[1],"number":[1],"PropDeclare":[1],"FnDeclare":[1]},"literalChoices":{"_":[0],")":[1],"->":[1],"sum":[1],"distinct":[1],"(":[1],"true":[1],"false":[1],"new":[1],"fn":[1],"-":[1],"~":[1],"type":[1],"for":[1],"logic":[1],"show":[1],"weak":[1],"{":[1],"}":[1]}},{"match":"_","reference":false,"to":[2],"label":null,"enclose":false,"typeChoices":{"id":[0],"symbol":[0],"number":[0],"keyword":[0]},"literalChoices":{"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"weak":[0],"{":[0]}},{"match":"BaseExpression","reference":true,"to":[3,4],"label":"indices","enclose":false,"repeated":true,"typeChoices":{"symbol":[0,1],"comma":[1],"keyword":[1],"id":[1],"number":[1],"PropDeclare":[1],"FnDeclare":[1]},"literalChoices":{",":[0],")":[1],"->":[1],"sum":[1],"distinct":[1],"(":[1],"true":[1],"false":[1],"new":[1],"fn":[1],"-":[1],"~":[1],"type":[1],"for":[1],"logic":[1],"show":[1],"weak":[1],"{":[1],"}":[1]}},{"match":",","reference":false,"to":[2],"label":null,"enclose":false,"repeated":true,"typeChoices":{"id":[0],"symbol":[0],"number":[0],"keyword":[0]},"literalChoices":{"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"weak":[0],"{":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":4,"name":"TypeReference"},"LiteralType":{"nodes":[{"match":null,"reference":false,"to":[1,3,4],"label":null,"enclose":false,"typeChoices":{"keyword":[0,1,2]},"literalChoices":{"Int":[0],"Bool":[1],"Real":[2]}},{"match":"Int","reference":false,"to":[2],"label":"name","enclose":false,"typeChoices":{"comma":[0],"symbol":[0],"keyword":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}},{"match":"Bool","reference":false,"to":[2],"label":"name","enclose":false,"typeChoices":{"comma":[0],"symbol":[0],"keyword":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":"Real","reference":false,"to":[2],"label":"name","enclose":false,"typeChoices":{"comma":[0],"symbol":[0],"keyword":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}}],"start":0,"end":2,"name":"LiteralType"},"TupleType":{"nodes":[{"match":"(","reference":false,"to":[1],"label":null,"enclose":false,"typeChoices":{"id":[0],"keyword":[0],"symbol":[0]},"literalChoices":{"Int":[0],"Bool":[0],"Real":[0],"(":[0]}},{"match":"SimpleType","reference":true,"to":[2,3],"label":"factors","enclose":false,"repeated":true,"typeChoices":{"comma":[0],"symbol":[1]},"literalChoices":{")":[1]}},{"match":"comma","reference":true,"to":[1],"label":null,"enclose":false,"repeated":true,"terminal":true,"typeChoices":{"id":[0],"keyword":[0],"symbol":[0]},"literalChoices":{"Int":[0],"Bool":[0],"Real":[0],"(":[0]}},{"match":")","reference":false,"to":[4],"label":null,"enclose":false,"typeChoices":{"comma":[0],"symbol":[0],"keyword":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":4,"name":"TupleType"},"SimpleType":{"nodes":[{"match":null,"reference":false,"to":[1,3,4],"label":null,"enclose":false,"typeChoices":{"symbol":[0],"keyword":[1],"id":[2]},"literalChoices":{"(":[0],"Int":[1],"Bool":[1],"Real":[1]}},{"match":"TupleType","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"comma":[0],"symbol":[0],"keyword":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}},{"match":"LiteralType","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"comma":[0],"symbol":[0],"keyword":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":"TypeReference","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"comma":[0],"symbol":[0],"keyword":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}}],"start":0,"end":2,"name":"SimpleType"},"FnType":{"nodes":[{"match":"SimpleType","reference":true,"to":[1,2],"label":"params","enclose":false,"repeated":true,"typeChoices":{"comma":[0],"symbol":[1]},"literalChoices":{"->":[1]}},{"match":"comma","reference":true,"to":[0],"label":null,"enclose":false,"repeated":true,"terminal":true,"typeChoices":{"id":[0],"keyword":[0],"symbol":[0]},"literalChoices":{"Int":[0],"Bool":[0],"Real":[0],"(":[0]}},{"match":"->","reference":false,"to":[3],"label":null,"enclose":false,"typeChoices":{"id":[0],"keyword":[0],"symbol":[0]},"literalChoices":{"Int":[0],"Bool":[0],"Real":[0],"(":[0]}},{"match":"SimpleType","reference":true,"to":[4],"label":"result","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":4,"name":"FnType"},"Type":{"nodes":[{"match":null,"reference":false,"to":[1,3],"label":null,"enclose":false,"typeChoices":{"id":[0,1],"keyword":[0,1],"symbol":[0,1]},"literalChoices":{"Int":[0,1],"Bool":[0,1],"Real":[0,1],"(":[0,1]}},{"match":"FnType","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}},{"match":"SimpleType","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}}],"start":0,"end":2,"name":"Type"},"AggregateType":{"nodes":[{"match":null,"reference":false,"to":[1,3],"label":null,"enclose":false,"typeChoices":{"keyword":[0,1]},"literalChoices":{"sum":[0],"distinct":[1]}},{"match":"sum","reference":false,"to":[2],"label":null,"enclose":false,"typeChoices":{"id":[0]},"literalChoices":{}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}},{"match":"distinct","reference":false,"to":[2],"label":null,"enclose":false,"typeChoices":{"id":[0]},"literalChoices":{}}],"start":0,"end":2,"name":"AggregateType"},"CallSuffix":{"nodes":[{"match":"(","reference":false,"to":[1],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":"Expression","reference":true,"to":[2,3],"label":"args","enclose":false,"repeated":true,"typeChoices":{"comma":[0],"symbol":[1]},"literalChoices":{")":[1]}},{"match":"comma","reference":true,"to":[1],"label":null,"enclose":false,"repeated":true,"terminal":true,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":")","reference":false,"to":[4],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":4,"name":"CallSuffix"},"IndexSuffix":{"nodes":[{"match":".","reference":false,"to":[1],"label":null,"enclose":false,"typeChoices":{"number":[0]},"literalChoices":{}},{"match":"number","reference":true,"to":[2],"label":"index","enclose":false,"terminal":true,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":2,"name":"IndexSuffix"},"Step":{"nodes":[{"match":null,"reference":false,"to":[1,3],"label":null,"enclose":false,"typeChoices":{"symbol":[0,1]},"literalChoices":{"(":[0],".":[1]}},{"match":"CallSuffix","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}},{"match":"IndexSuffix","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}}],"start":0,"end":2,"name":"Step"},"Call":{"nodes":[{"match":"Expression","reference":true,"to":[1],"label":"fn","enclose":false,"typeChoices":{"symbol":[0]},"literalChoices":{"(":[0]}},{"match":"(","reference":false,"to":[2],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":"Expression","reference":true,"to":[3,4],"label":"args","enclose":false,"repeated":true,"typeChoices":{"comma":[0],"symbol":[1]},"literalChoices":{")":[1]}},{"match":"comma","reference":true,"to":[2],"label":null,"enclose":false,"repeated":true,"terminal":true,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":")","reference":false,"to":[5],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":5,"name":"Call"},"Index":{"nodes":[{"match":"Expression","reference":true,"to":[1],"label":"tuple","enclose":false,"typeChoices":{"symbol":[0]},"literalChoices":{".":[0]}},{"match":".","reference":false,"to":[2],"label":null,"enclose":false,"typeChoices":{"number":[0]},"literalChoices":{}},{"match":"number","reference":true,"to":[3],"label":"index","enclose":false,"terminal":true,"typeChoices":{},"literalChoices":{}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":3,"name":"Index"},"Reference":{"nodes":[{"match":"id","reference":true,"to":[1,4],"label":"name","enclose":false,"terminal":true,"typeChoices":{"keyword":[0,1],"comma":[1],"symbol":[1],"id":[1],"number":[1],"PropDeclare":[1],"FnDeclare":[1]},"literalChoices":{"_":[0],"on":[1],"]":[1],":":[1],",":[1],")":[1],"->":[1],"sum":[1],"distinct":[1],"(":[1],".":[1],"true":[1],"false":[1],"new":[1],"fn":[1],"-":[1],"~":[1],"*":[1],"/":[1],"%":[1],"+":[1],"=":[1],"!=":[1],"<=":[1],">=":[1],"<":[1],">":[1],"and":[1],"or":[1],"=>":[1],"type":[1],"for":[1],"logic":[1],"show":[1],":=":[1],"weak":[1],"{":[1],"}":[1]}},{"match":"_","reference":false,"to":[2],"label":null,"enclose":false,"typeChoices":{"id":[0],"symbol":[0],"number":[0],"keyword":[0]},"literalChoices":{"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"weak":[0],"{":[0]}},{"match":"BaseExpression","reference":true,"to":[3,4],"label":"indices","enclose":false,"repeated":true,"typeChoices":{"symbol":[0,1],"comma":[1],"keyword":[1],"id":[1],"number":[1],"PropDeclare":[1],"FnDeclare":[1]},"literalChoices":{",":[0,1],"on":[1],"]":[1],":":[1],")":[1],"->":[1],"sum":[1],"distinct":[1],"(":[1],".":[1],"true":[1],"false":[1],"new":[1],"fn":[1],"-":[1],"~":[1],"*":[1],"/":[1],"%":[1],"+":[1],"=":[1],"!=":[1],"<=":[1],">=":[1],"<":[1],">":[1],"and":[1],"or":[1],"=>":[1],"type":[1],"for":[1],"logic":[1],"show":[1],":=":[1],"weak":[1],"{":[1],"}":[1]}},{"match":",","reference":false,"to":[2],"label":null,"enclose":false,"repeated":true,"typeChoices":{"id":[0],"symbol":[0],"number":[0],"keyword":[0]},"literalChoices":{"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"weak":[0],"{":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":4,"name":"Reference"},"Nested":{"nodes":[{"match":"(","reference":false,"to":[1],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":"Expression","reference":true,"to":[2],"label":"replace","enclose":false,"typeChoices":{"symbol":[0]},"literalChoices":{")":[0]}},{"match":")","reference":false,"to":[3],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":3,"name":"Nested"},"Number":{"nodes":[{"match":"number","reference":true,"to":[1],"label":"value","enclose":false,"terminal":true,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":1,"name":"Number"},"Bool":{"nodes":[{"match":null,"reference":false,"to":[1,3],"label":null,"enclose":false,"typeChoices":{"keyword":[0,1]},"literalChoices":{"true":[0],"false":[1]}},{"match":"true","reference":false,"to":[2],"label":"value","enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}},{"match":"false","reference":false,"to":[2],"label":"value","enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}}],"start":0,"end":2,"name":"Bool"},"New":{"nodes":[{"match":"new","reference":false,"to":[1],"label":null,"enclose":false,"typeChoices":{"id":[0]},"literalChoices":{}},{"match":"TypeReference","reference":true,"to":[2],"label":"type","enclose":false,"typeChoices":{"symbol":[0]},"literalChoices":{"(":[0]}},{"match":"(","reference":false,"to":[3],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":"Expression","reference":true,"to":[4,5],"label":"args","enclose":false,"repeated":true,"typeChoices":{"comma":[0],"symbol":[1]},"literalChoices":{")":[1]}},{"match":"comma","reference":true,"to":[3],"label":null,"enclose":false,"repeated":true,"terminal":true,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":")","reference":false,"to":[6],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":6,"name":"New"},"Fn":{"nodes":[{"match":"fn","reference":false,"to":[1],"label":null,"enclose":false,"typeChoices":{"symbol":[0]},"literalChoices":{"(":[0]}},{"match":"(","reference":false,"to":[2],"label":null,"enclose":false,"typeChoices":{"id":[0]},"literalChoices":{}},{"match":"Reference","reference":true,"to":[3,4],"label":"params","enclose":false,"repeated":true,"typeChoices":{"comma":[0],"symbol":[1]},"literalChoices":{")":[1]}},{"match":"comma","reference":true,"to":[2],"label":null,"enclose":false,"repeated":true,"terminal":true,"typeChoices":{"id":[0]},"literalChoices":{}},{"match":")","reference":false,"to":[5],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":"Expression","reference":true,"to":[6],"label":"body","enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":6,"name":"Fn"},"BaseExpression":{"nodes":[{"match":null,"reference":false,"to":[1,3,4,5,6,7,8],"label":null,"enclose":false,"typeChoices":{"symbol":[0,1],"keyword":[1,4,5,6],"id":[2],"number":[3]},"literalChoices":{"(":[0],"weak":[1],"{":[1],"true":[4],"false":[4],"new":[5],"fn":[6]}},{"match":"Nested","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}},{"match":"Block","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":"Reference","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":"Number","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":"Bool","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":"New","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":"Fn","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}}],"start":0,"end":2,"name":"BaseExpression"},"Term":{"nodes":[{"match":"BaseExpression","reference":true,"to":[1],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[2,4],"label":null,"enclose":false,"typeChoices":{"symbol":[0,1],"comma":[1],"keyword":[1],"id":[1],"number":[1],"PropDeclare":[1],"FnDeclare":[1]},"literalChoices":{"(":[0,1],".":[0,1],"on":[1],"]":[1],":":[1],",":[1],")":[1],"->":[1],"sum":[1],"distinct":[1],"true":[1],"false":[1],"new":[1],"fn":[1],"-":[1],"~":[1],"*":[1],"/":[1],"%":[1],"+":[1],"=":[1],"!=":[1],"<=":[1],">=":[1],"<":[1],">":[1],"and":[1],"or":[1],"=>":[1],"type":[1],"for":[1],"logic":[1],"show":[1],":=":[1],"weak":[1],"{":[1],"}":[1]}},{"match":null,"reference":false,"to":[3],"label":"base","enclose":true,"typeChoices":{"symbol":[0]},"literalChoices":{"(":[0],".":[0]}},{"match":"Step","reference":true,"to":[1],"label":"step","enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":4,"name":"Term"},"Aggregate":{"nodes":[{"match":null,"reference":false,"to":[1,6],"label":null,"enclose":false,"typeChoices":{"keyword":[0,1],"id":[1],"symbol":[1],"number":[1]},"literalChoices":{"sum":[0],"distinct":[0],"(":[1],"true":[1],"false":[1],"new":[1],"fn":[1],"weak":[1],"{":[1]}},{"match":"AggregateType","reference":true,"to":[2],"label":"type","enclose":false,"typeChoices":{"id":[0]},"literalChoices":{}},{"match":"FiniteRange","reference":true,"to":[3],"label":"range","enclose":false,"typeChoices":{"keyword":[0]},"literalChoices":{"of":[0]}},{"match":"of","reference":false,"to":[4],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"weak":[0],"{":[0]}},{"match":"Aggregate","reference":true,"to":[5],"label":"body","enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}},{"match":"Term","reference":true,"to":[5],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}}],"start":0,"end":5,"name":"Aggregate"},"Prefix":{"nodes":[{"match":null,"reference":false,"to":[1,4,5],"label":null,"enclose":false,"typeChoices":{"symbol":[0,1,2],"keyword":[2],"id":[2],"number":[2]},"literalChoices":{"-":[0],"~":[1],"sum":[2],"distinct":[2],"(":[2],"true":[2],"false":[2],"new":[2],"fn":[2],"weak":[2],"{":[2]}},{"match":"-","reference":false,"to":[2],"label":"op","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":"Prefix","reference":true,"to":[3],"label":"target","enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}},{"match":"~","reference":false,"to":[2],"label":"op","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":"Aggregate","reference":true,"to":[3],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}}],"start":0,"end":3,"name":"Prefix"},"Product":{"nodes":[{"match":"Prefix","reference":true,"to":[1],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[2,7],"label":null,"enclose":false,"typeChoices":{"symbol":[0,1],"comma":[1],"keyword":[1],"id":[1],"number":[1],"PropDeclare":[1],"FnDeclare":[1]},"literalChoices":{"*":[0,1],"/":[0,1],"%":[0,1],"on":[1],"]":[1],":":[1],",":[1],")":[1],"->":[1],"sum":[1],"distinct":[1],"(":[1],".":[1],"true":[1],"false":[1],"new":[1],"fn":[1],"-":[1],"~":[1],"+":[1],"=":[1],"!=":[1],"<=":[1],">=":[1],"<":[1],">":[1],"and":[1],"or":[1],"=>":[1],"type":[1],"for":[1],"logic":[1],"show":[1],":=":[1],"weak":[1],"{":[1],"}":[1]}},{"match":null,"reference":false,"to":[3,5,6],"label":"left","enclose":true,"typeChoices":{"symbol":[0,1,2]},"literalChoices":{"*":[0],"/":[1],"%":[2]}},{"match":"*","reference":false,"to":[4],"label":"op","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":"Prefix","reference":true,"to":[1],"label":"right","enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":"/","reference":false,"to":[4],"label":"op","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":"%","reference":false,"to":[4],"label":"op","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":7,"name":"Product"},"Sum":{"nodes":[{"match":"Product","reference":true,"to":[1],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[2,6],"label":null,"enclose":false,"typeChoices":{"symbol":[0,1],"comma":[1],"keyword":[1],"id":[1],"number":[1],"PropDeclare":[1],"FnDeclare":[1]},"literalChoices":{"+":[0,1],"-":[0,1],"on":[1],"]":[1],":":[1],",":[1],")":[1],"->":[1],"sum":[1],"distinct":[1],"(":[1],".":[1],"true":[1],"false":[1],"new":[1],"fn":[1],"~":[1],"*":[1],"/":[1],"%":[1],"=":[1],"!=":[1],"<=":[1],">=":[1],"<":[1],">":[1],"and":[1],"or":[1],"=>":[1],"type":[1],"for":[1],"logic":[1],"show":[1],":=":[1],"weak":[1],"{":[1],"}":[1]}},{"match":null,"reference":false,"to":[3,5],"label":"left","enclose":true,"typeChoices":{"symbol":[0,1]},"literalChoices":{"+":[0],"-":[1]}},{"match":"+","reference":false,"to":[4],"label":"op","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":"Product","reference":true,"to":[1],"label":"right","enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":"-","reference":false,"to":[4],"label":"op","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":6,"name":"Sum"},"Compare":{"nodes":[{"match":"Sum","reference":true,"to":[1],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[2,10],"label":null,"enclose":false,"typeChoices":{"symbol":[0,1],"comma":[1],"keyword":[1],"id":[1],"number":[1],"PropDeclare":[1],"FnDeclare":[1]},"literalChoices":{"=":[0,1],"!=":[0,1],"<=":[0,1],">=":[0,1],"<":[0,1],">":[0,1],"on":[1],"]":[1],":":[1],",":[1],")":[1],"->":[1],"sum":[1],"distinct":[1],"(":[1],".":[1],"true":[1],"false":[1],"new":[1],"fn":[1],"-":[1],"~":[1],"*":[1],"/":[1],"%":[1],"+":[1],"and":[1],"or":[1],"=>":[1],"type":[1],"for":[1],"logic":[1],"show":[1],":=":[1],"weak":[1],"{":[1],"}":[1]}},{"match":null,"reference":false,"to":[3,5,6,7,8,9],"label":"left","enclose":true,"typeChoices":{"symbol":[0,1,2,3,4,5]},"literalChoices":{"=":[0],"!=":[1],"<=":[2],">=":[3],"<":[4],">":[5]}},{"match":"=","reference":false,"to":[4],"label":"op","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":"Sum","reference":true,"to":[1],"label":"right","enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":"!=","reference":false,"to":[4],"label":"op","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":"<=","reference":false,"to":[4],"label":"op","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":">=","reference":false,"to":[4],"label":"op","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":"<","reference":false,"to":[4],"label":"op","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":">","reference":false,"to":[4],"label":"op","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":10,"name":"Compare"},"Logic":{"nodes":[{"match":"Compare","reference":true,"to":[1],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[2,6],"label":null,"enclose":false,"typeChoices":{"keyword":[0,1],"comma":[1],"symbol":[1],"id":[1],"number":[1],"PropDeclare":[1],"FnDeclare":[1]},"literalChoices":{"and":[0,1],"or":[0,1],"on":[1],"]":[1],":":[1],",":[1],")":[1],"->":[1],"sum":[1],"distinct":[1],"(":[1],".":[1],"true":[1],"false":[1],"new":[1],"fn":[1],"-":[1],"~":[1],"*":[1],"/":[1],"%":[1],"+":[1],"=":[1],"!=":[1],"<=":[1],">=":[1],"<":[1],">":[1],"=>":[1],"type":[1],"for":[1],"logic":[1],"show":[1],":=":[1],"weak":[1],"{":[1],"}":[1]}},{"match":null,"reference":false,"to":[3,5],"label":"left","enclose":true,"typeChoices":{"keyword":[0,1]},"literalChoices":{"and":[0],"or":[1]}},{"match":"and","reference":false,"to":[4],"label":"op","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":"Compare","reference":true,"to":[1],"label":"right","enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":"or","reference":false,"to":[4],"label":"op","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":6,"name":"Logic"},"Implies":{"nodes":[{"match":"Logic","reference":true,"to":[1,4],"label":null,"enclose":false,"typeChoices":{"symbol":[0,1],"comma":[1],"keyword":[1],"id":[1],"number":[1],"PropDeclare":[1],"FnDeclare":[1]},"literalChoices":{"=>":[0,1],"on":[1],"]":[1],":":[1],",":[1],")":[1],"->":[1],"sum":[1],"distinct":[1],"(":[1],".":[1],"true":[1],"false":[1],"new":[1],"fn":[1],"-":[1],"~":[1],"*":[1],"/":[1],"%":[1],"+":[1],"=":[1],"!=":[1],"<=":[1],">=":[1],"<":[1],">":[1],"and":[1],"or":[1],"type":[1],"for":[1],"logic":[1],"show":[1],":=":[1],"weak":[1],"{":[1],"}":[1]}},{"match":null,"reference":true,"to":[2],"label":"left","enclose":true,"terminal":true,"typeChoices":{"symbol":[0]},"literalChoices":{"=>":[0]}},{"match":"=>","reference":false,"to":[3],"label":"op","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":"Implies","reference":true,"to":[4],"label":"right","enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":4,"name":"Implies"},"Expression":{"nodes":[{"match":"Implies","reference":true,"to":[1],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":1,"name":"Expression"},"VarDeclare":{"nodes":[{"match":"Reference","reference":true,"to":[1],"label":"name","enclose":false,"typeChoices":{"symbol":[0]},"literalChoices":{":":[0]}},{"match":":","reference":false,"to":[2],"label":null,"enclose":false,"typeChoices":{"id":[0],"keyword":[0],"symbol":[0]},"literalChoices":{"Int":[0],"Bool":[0],"Real":[0],"(":[0]}},{"match":"Type","reference":true,"to":[3],"label":"type","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":3,"name":"VarDeclare"},"TypeDeclare":{"nodes":[{"match":"type","reference":false,"to":[1],"label":null,"enclose":false,"typeChoices":{"id":[0]},"literalChoices":{}},{"match":"Reference","reference":true,"to":[2],"label":"name","enclose":false,"typeChoices":{"symbol":[0]},"literalChoices":{"=":[0]}},{"match":"=","reference":false,"to":[3],"label":null,"enclose":false,"typeChoices":{"id":[0],"keyword":[0],"symbol":[0]},"literalChoices":{"Int":[0],"Bool":[0],"Real":[0],"(":[0]}},{"match":"Type","reference":true,"to":[4],"label":"type","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":4,"name":"TypeDeclare"},"Declare":{"nodes":[{"match":null,"reference":false,"to":[1,3,4,5],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"PropDeclare":[1],"FnDeclare":[2],"id":[3]},"literalChoices":{"type":[0]}},{"match":"TypeDeclare","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}},{"match":"PropDeclare","reference":true,"to":[2],"label":null,"enclose":false,"terminal":true,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":"FnDeclare","reference":true,"to":[2],"label":null,"enclose":false,"terminal":true,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":"VarDeclare","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}}],"start":0,"end":2,"name":"Declare"},"Loop":{"nodes":[{"match":"for","reference":false,"to":[1,4],"label":null,"enclose":false,"typeChoices":{"id":[0,1]},"literalChoices":{}},{"match":"FiniteRange","reference":true,"to":[2],"label":"range","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0]}},{"match":"Statement","reference":true,"to":[3],"label":"body","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}},{"match":"UniversalRange","reference":true,"to":[2],"label":"range","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0]}}],"start":0,"end":3,"name":"Loop"},"SetLogic":{"nodes":[{"match":"logic","reference":false,"to":[1],"label":null,"enclose":false,"typeChoices":{"id":[0]},"literalChoices":{}},{"match":"id","reference":true,"to":[2],"label":"id","enclose":false,"terminal":true,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":2,"name":"SetLogic"},"Show":{"nodes":[{"match":"show","reference":false,"to":[1],"label":null,"enclose":false,"typeChoices":{"id":[0]},"literalChoices":{}},{"match":"Reference","reference":true,"to":[2],"label":"ref","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":2,"name":"Show"},"Assign":{"nodes":[{"match":"Reference","reference":true,"to":[1],"label":"name","enclose":false,"typeChoices":{"symbol":[0]},"literalChoices":{":=":[0]}},{"match":":=","reference":false,"to":[2],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"weak":[0],"{":[0]}},{"match":"Expression","reference":true,"to":[3],"label":"value","enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":3,"name":"Assign"},"Statement":{"nodes":[{"match":null,"reference":false,"to":[1,3,4,5,6,7],"label":null,"enclose":false,"typeChoices":{"keyword":[0,1,2,3,5],"id":[2,4,5],"PropDeclare":[2],"FnDeclare":[2],"symbol":[5],"number":[5]},"literalChoices":{"show":[0],"logic":[1],"type":[2],"for":[3],"sum":[5],"distinct":[5],"(":[5],"true":[5],"false":[5],"new":[5],"fn":[5],"-":[5],"~":[5],"weak":[5],"{":[5]}},{"match":"Show","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}},{"match":"SetLogic","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":"Declare","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":"Loop","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":"Assign","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}},{"match":"Expression","reference":true,"to":[2],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[0]}}],"start":0,"end":2,"name":"Statement"},"root":{"nodes":[{"match":null,"reference":false,"to":[1,2],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0]}},{"match":"Statement","reference":true,"to":[1,2],"label":"stmts","enclose":false,"repeated":true,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":2,"name":"root"},"Block":{"nodes":[{"match":null,"reference":false,"to":[1,2],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"symbol":[1]},"literalChoices":{"weak":[0],"{":[1]}},{"match":"weak","reference":false,"to":[2],"label":"weak","enclose":false,"typeChoices":{"symbol":[0]},"literalChoices":{"{":[0]}},{"match":"{","reference":false,"to":[3,4],"label":null,"enclose":false,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0,1],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[1]}},{"match":"Statement","reference":true,"to":[3,4],"label":"stmts","enclose":false,"repeated":true,"typeChoices":{"keyword":[0],"id":[0],"symbol":[0,1],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"sum":[0],"distinct":[0],"(":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"type":[0],"for":[0],"logic":[0],"show":[0],"weak":[0],"{":[0],"}":[1]}},{"match":"}","reference":false,"to":[5],"label":null,"enclose":false,"typeChoices":{"comma":[0],"keyword":[0],"symbol":[0],"id":[0],"number":[0],"PropDeclare":[0],"FnDeclare":[0]},"literalChoices":{"on":[0],"]":[0],":":[0],",":[0],")":[0],"->":[0],"sum":[0],"distinct":[0],"(":[0],".":[0],"true":[0],"false":[0],"new":[0],"fn":[0],"-":[0],"~":[0],"*":[0],"/":[0],"%":[0],"+":[0],"=":[0],"!=":[0],"<=":[0],">=":[0],"<":[0],">":[0],"and":[0],"or":[0],"=>":[0],"type":[0],"for":[0],"logic":[0],"show":[0],":=":[0],"weak":[0],"{":[0],"}":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":5,"name":"Block"}},"printers":{"FiniteRange":[{"repeat":{"key":"vars","type":"Reference"},"delimiter":{"key":"replace","type":"comma"}},"on","[",{"key":"lo","type":"Expression"},{"key":"replace","type":"comma"},{"key":"hi","type":"Expression"},"]"],"UniversalRange":[{"repeat":{"key":"vars","type":"Reference"},"delimiter":{"key":"replace","type":"comma"}},":",{"key":"type","type":"Type"}],"ReferenceLike":[{"key":"name","type":"id"},{"options":[[["indices"],["_",{"repeat":{"key":"indices","type":"BaseExpression"},"delimiter":","}]],[[],[]]]}],"TypeReference":[{"key":"name","type":"id"},{"options":[[["indices"],["_",{"repeat":{"key":"indices","type":"BaseExpression"},"delimiter":","}]],[[],[]]]}],"LiteralType":{"options":[[[],{"key":"name"}],[[],{"key":"name"}],[[],{"key":"name"}]]},"TupleType":["(",{"repeat":{"key":"factors","type":"SimpleType"},"delimiter":{"key":"replace","type":"comma"}},")"],"SimpleType":{"options":[[[],{"key":"replace","type":"LiteralType"}],[[],{"key":"replace","type":"TypeReference"}],[[],{"key":"replace","type":"TupleType"}]]},"FnType":[{"repeat":{"key":"params","type":"SimpleType"},"delimiter":{"key":"replace","type":"comma"}},"->",{"key":"result","type":"SimpleType"}],"Type":{"options":[[[],{"key":"replace","type":"FnType"}],[[],{"key":"replace","type":"SimpleType"}]]},"AggregateType":{"options":[[[],"sum"],[[],"distinct"]]},"CallSuffix":["(",{"repeat":{"key":"args","type":"Expression"},"delimiter":{"key":"replace","type":"comma"}},")"],"IndexSuffix":[".",{"key":"index","type":"number"}],"Step":{"options":[[[],{"key":"replace","type":"IndexSuffix"}],[[],{"key":"replace","type":"CallSuffix"}]]},"Call":[{"key":"fn","type":"Expression"},["(",{"repeat":{"key":"args","type":"Expression"},"delimiter":{"key":"replace","type":"comma"}},")"]],"Index":[{"key":"tuple","type":"Expression"},[".",{"key":"index","type":"number"}]],"Reference":[{"key":"name","type":"id"},{"options":[[["indices"],["_",{"repeat":{"key":"indices","type":"BaseExpression"},"delimiter":","}]],[[],[]]]}],"Nested":["(",{"key":"replace","type":"Expression"},")"],"Number":{"key":"value","type":"number"},"Bool":{"options":[[[],{"key":"value"}],[[],{"key":"value"}]]},"New":["new",{"key":"type","type":"TypeReference"},"(",{"repeat":{"key":"args","type":"Expression"},"delimiter":{"key":"replace","type":"comma"}},")"],"Fn":["fn","(",{"repeat":{"key":"params","type":"Reference"},"delimiter":{"key":"replace","type":"comma"}},")",{"key":"body","type":"Expression"}],"BaseExpression":{"options":[[[],{"key":"replace","type":"Block"}],[[],{"key":"replace","type":"Reference"}],[[],{"key":"replace","type":"Number"}],[[],{"key":"replace","type":"Bool"}],[[],{"key":"replace","type":"New"}],[[],{"key":"replace","type":"Fn"}],[[],{"key":"replace","type":"Nested"}]]},"Term":{"options":[[["base","step"],[{"key":"base","type":"Term"},{"key":"step","type":"Step"}]],[[],{"key":"replace","type":"BaseExpression"}]]},"Aggregate":{"options":[[["type","range","body"],[{"key":"type","type":"AggregateType"},{"key":"range","type":"FiniteRange"},"of",{"key":"body","type":"Aggregate"}]],[[],{"key":"replace","type":"Term"}]]},"Prefix":{"options":[[["op","target"],[{"options":[[[],{"key":"op"}],[[],{"key":"op"}]]},{"key":"target","type":"Prefix"}]],[[],{"key":"replace","type":"Aggregate"}]]},"Product":{"options":[[["left","op","right"],[{"key":"left","type":"Product"},{"options":[[[],{"key":"op"}],[[],{"key":"op"}],[[],{"key":"op"}]]},{"key":"right","type":"Prefix"}]],[[],{"key":"replace","type":"Prefix"}]]},"Sum":{"options":[[["left","op","right"],[{"key":"left","type":"Sum"},{"options":[[[],{"key":"op"}],[[],{"key":"op"}]]},{"key":"right","type":"Product"}]],[[],{"key":"replace","type":"Product"}]]},"Compare":{"options":[[["left","op","right"],[{"key":"left","type":"Compare"},{"options":[[[],{"key":"op"}],[[],{"key":"op"}],[[],{"key":"op"}],[[],{"key":"op"}],[[],{"key":"op"}],[[],{"key":"op"}]]},{"key":"right","type":"Sum"}]],[[],{"key":"replace","type":"Sum"}]]},"Logic":{"options":[[["left","op","right"],[{"key":"left","type":"Logic"},{"options":[[[],{"key":"op"}],[[],{"key":"op"}]]},{"key":"right","type":"Compare"}]],[[],{"key":"replace","type":"Compare"}]]},"Implies":{"options":[[["left","op","right"],[{"key":"left","type":"Logic"},{"key":"op"},{"key":"right","type":"Implies"}]],[[],{"key":"replace","type":"Logic"}]]},"Expression":{"key":"replace","type":"Implies"},"VarDeclare":[{"key":"name","type":"Reference"},":",{"key":"type","type":"Type"}],"TypeDeclare":["type",{"key":"name","type":"Reference"},"=",{"key":"type","type":"Type"}],"Declare":{"options":[[[],{"key":"replace","type":"PropDeclare"}],[[],{"key":"replace","type":"FnDeclare"}],[[],{"key":"replace","type":"TypeDeclare"}],[[],{"key":"replace","type":"VarDeclare"}]]},"Loop":["for",{"options":[[[],{"key":"range","type":"FiniteRange"}],[[],{"key":"range","type":"UniversalRange"}]]},{"key":"body","type":"Statement"}],"SetLogic":["logic",{"key":"id","type":"id"}],"Show":["show",{"key":"ref","type":"Reference"}],"Assign":[{"key":"name","type":"Reference"},":=",{"key":"value","type":"Expression"}],"Statement":{"options":[[[],{"key":"replace","type":"Show"}],[[],{"key":"replace","type":"SetLogic"}],[[],{"key":"replace","type":"Loop"}],[[],{"key":"replace","type":"Assign"}],[[],{"key":"replace","type":"Declare"}],[[],{"key":"replace","type":"Expression"}]]},"root":{"repeat":{"key":"stmts","type":"Statement"}},"Block":[{"options":[[["weak"],{"key":"weak"}],[[],[]]]},"{",{"repeat":{"key":"stmts","type":"Statement"}},"}"]},"replacements":{"FiniteRange":["FiniteRange","comma"],"UniversalRange":["UniversalRange","comma"],"ReferenceLike":["ReferenceLike"],"TypeReference":["TypeReference"],"LiteralType":["LiteralType"],"TupleType":["TupleType","comma"],"SimpleType":["SimpleType","TupleType","comma","LiteralType","TypeReference"],"FnType":["FnType","comma"],"Type":["Type","FnType","comma","SimpleType","TupleType","LiteralType","TypeReference"],"AggregateType":["AggregateType"],"CallSuffix":["CallSuffix","comma"],"IndexSuffix":["IndexSuffix"],"Step":["Step","CallSuffix","comma","IndexSuffix"],"Call":["Call","comma"],"Index":["Index"],"Reference":["Reference"],"Nested":["Nested","Expression","Implies","Logic","Compare","Sum","Product","Prefix","Aggregate","Term","BaseExpression","Block","Reference","Number","Bool","New","comma","Fn"],"Number":["Number"],"Bool":["Bool"],"New":["New","comma"],"Fn":["Fn","comma"],"BaseExpression":["BaseExpression","Nested","Expression","Implies","Logic","Compare","Sum","Product","Prefix","Aggregate","Term","Block","Reference","Number","Bool","New","comma","Fn"],"Term":["Term","BaseExpression","Nested","Expression","Implies","Logic","Compare","Sum","Product","Prefix","Aggregate","Block","Reference","Number","Bool","New","comma","Fn"],"Aggregate":["Aggregate","Term","BaseExpression","Nested","Expression","Implies","Logic","Compare","Sum","Product","Prefix","Block","Reference","Number","Bool","New","comma","Fn"],"Prefix":["Prefix","Aggregate","Term","BaseExpression","Nested","Expression","Implies","Logic","Compare","Sum","Product","Block","Reference","Number","Bool","New","comma","Fn"],"Product":["Product","Prefix","Aggregate","Term","BaseExpression","Nested","Expression","Implies","Logic","Compare","Sum","Block","Reference","Number","Bool","New","comma","Fn"],"Sum":["Sum","Product","Prefix","Aggregate","Term","BaseExpression","Nested","Expression","Implies","Logic","Compare","Block","Reference","Number","Bool","New","comma","Fn"],"Compare":["Compare","Sum","Product","Prefix","Aggregate","Term","BaseExpression","Nested","Expression","Implies","Logic","Block","Reference","Number","Bool","New","comma","Fn"],"Logic":["Logic","Compare","Sum","Product","Prefix","Aggregate","Term","BaseExpression","Nested","Expression","Implies","Block","Reference","Number","Bool","New","comma","Fn"],"Implies":["Implies","Logic","Compare","Sum","Product","Prefix","Aggregate","Term","BaseExpression","Nested","Expression","Block","Reference","Number","Bool","New","comma","Fn"],"Expression":["Expression","Implies","Logic","Compare","Sum","Product","Prefix","Aggregate","Term","BaseExpression","Nested","Block","Reference","Number","Bool","New","comma","Fn"],"VarDeclare":["VarDeclare"],"TypeDeclare":["TypeDeclare"],"Declare":["Declare","TypeDeclare","PropDeclare","FnDeclare","VarDeclare"],"Loop":["Loop"],"SetLogic":["SetLogic"],"Show":["Show"],"Assign":["Assign"],"Statement":["Statement","Show","SetLogic","Declare","TypeDeclare","PropDeclare","FnDeclare","VarDeclare","Loop","Assign","Expression","Implies","Logic","Compare","Sum","Product","Prefix","Aggregate","Term","BaseExpression","Nested","Block","Reference","Number","Bool","New","comma","Fn"],"root":["root"],"Block":["Block"]}};
	const definitionNames = ["FiniteRange","UniversalRange","ReferenceLike","TypeReference","LiteralType","TupleType","SimpleType","FnType","Type","AggregateType","CallSuffix","IndexSuffix","Step","Call","Index","Reference","Nested","Number","Bool","New","Fn","BaseExpression","Term","Aggregate","Prefix","Product","Sum","Compare","Logic","Implies","Expression","VarDeclare","TypeDeclare","Declare","Loop","SetLogic","Show","Assign","Statement","root","Block"];
	for (const name of definitionNames) {
		definitions[name] = Graph.hydrate(definitions[name]);
		AST[name].printer = printers[name];
		AST[name].replacements = replacements[name];
	}

	for (const name of definitionNames)
		definitions[name].preprocess();
	
	function parse(source, {
		showError = true,
		term = "root",
		filename
	} = { }) {
		source = source.replace(/\r/g, "");
		const stream = TokenStreamBuilder.regex(source, regex, filename);
		
		const tokens = stream.all.filter(token => !hidden.has(token.type.name));

		let lastErrorPosition = -1;
		let lastError = null;
		let termStack = [];
	
		function error(message, index) {
			const position = index ?? 0;
			if (position > lastErrorPosition) {
				lastErrorPosition = position;
				const index = Math.min(position, tokens.length - 1);
				const token = index < 0 ? null : tokens[index];
				lastError = new ParseError(message, token, [...termStack]);
			}
	
			return null;
		}

		function makeIndent(add) {
			const colors = ["magenta", "cyan", "blue", "yellow"];
			const count = add ? makeIndent.count++ : --makeIndent.count;
			let result = "";
			for (let i = 0; i < count; i++)
				result += color(colors[i % colors.length], "│ ");
			return result;
		}
		makeIndent.count = 0;

		function matchTerm(graph, index) {
			termStack.push(graph.name);
			// console.log(`${makeIndent(true)}├ ${graph.name}?`);
			const match = matchFromNode(new graph.astClass(index), graph.start, index);
			// console.log(`${makeIndent(false)}├ ${match === null ? color("red", "no.") : color("green", "yes!")}`);
			termStack.pop();
	
			if (match === null)
				return null;
	
			match[0] = match[0].finalize(tokens);

			return match;
		}
	
		function matchFromNode(result, node, index) {
			while (true) {
				const match = matchNode(result, node, index);
		
				if (match === null)
					return null;
		
				if (node.to.length === 0) {
					if (termStack.length === 1 && match < tokens.length)
						return error(`Grammar couldn't explain complete input`, index);
					return [result, match];
				}

				const token = tokens[match];
				let { to } = node;
				if (token) {
					to = node.literalChoices[token.content];
					if (to === undefined || typeof to !== "object")
						to = node.typeChoices[token.type.name];
					if (to === undefined || typeof to !== "object")
						return error("Unexpected token", match);
					
					if (to.length > 1) {
						for (let i = 0; i < to.length; i++) {
							const subMatch = matchFromNode(result.shallowCopy(), to[i], match);
							if (subMatch !== null) return subMatch;
						}

						return null;
					}
				}
	
				node = to[to.length - 1];
				index = match;
			}
		}
	
		function matchNode(result, node, index) {
			const { match } = node;
			
			if (match === null) {
				if (node.enclose) {
					const enclosed = result.shallowCopy().finalize(tokens);
					result.clear();
					result.setProperty(node, enclosed, index);
				}

				return index;
			}
	
			const token = tokens[index];

			if (!token) 
				return error("Unexpected end of input", index);

			let value;

			if (node.reference) {
				if (node.terminal) {
					if (token.type.name === match) {
						value = token.content;
						index++;
					} else return error(`Unexpected token, expected a token of type '${match}'`, index);
				} else {
					const term = matchTerm(match, index);
					if (term === null) return null;

					value = term[0];
					index = term[1];
				}
			} else {
				if (token.content === match) {
					value = token.content;
					index++;
				} else return error(`Unexpected token, expected '${match}'`, index);
			}

			result.setProperty(node, value, index - 1);
	
			return index;
		}
	
		const result = matchTerm(definitions[term], 0);
	
		if (result === null) {
			if (showError) lastError.show();
			else throw lastError;
		}

		return result[0];
	}

	return parse;
})();export { AST, parse }
