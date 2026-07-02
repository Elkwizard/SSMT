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
	AST.Expr = class Expr extends AST { static labels = ["items","value"]; static categories = new Set([]); };
AST.root = class root extends AST { static labels = ["items"]; static categories = new Set([]); };
	
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

	const regex = [[/^(?:\s+)/, "whitespace", null], [/^(?:[()])/, "symbol", null], [/^(?:[^\s()]*)/, "token", null]];
	const types = { };
	const hidden = new Set(["whitespace"]);
	for (const pair of regex) {
		const name = pair[1];
		types[name] = { name, toString: () => name };
		pair[1] = types[name];
	}
	
	const { definitions, printers, replacements } = {"definitions":{"Expr":{"nodes":[{"match":null,"reference":false,"to":[1,5],"label":null,"enclose":false,"typeChoices":{"symbol":[0],"token":[1]},"literalChoices":{"(":[0]}},{"match":"(","reference":false,"to":[2,3],"label":null,"enclose":false,"typeChoices":{"symbol":[0,1],"token":[0]},"literalChoices":{"(":[0],")":[1]}},{"match":"Expr","reference":true,"to":[2,3],"label":"items","enclose":false,"repeated":true,"typeChoices":{"symbol":[0,1],"token":[0]},"literalChoices":{"(":[0],")":[1]}},{"match":")","reference":false,"to":[4],"label":null,"enclose":false,"typeChoices":{"symbol":[0],"token":[0]},"literalChoices":{"(":[0],")":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}},{"match":"token","reference":true,"to":[4],"label":"value","enclose":false,"terminal":true,"typeChoices":{"symbol":[0],"token":[0]},"literalChoices":{"(":[0],")":[0]}}],"start":0,"end":4,"name":"Expr"},"root":{"nodes":[{"match":null,"reference":false,"to":[1,2],"label":null,"enclose":false,"typeChoices":{"symbol":[0],"token":[0]},"literalChoices":{"(":[0]}},{"match":"Expr","reference":true,"to":[1,2],"label":"items","enclose":false,"repeated":true,"typeChoices":{"symbol":[0],"token":[0]},"literalChoices":{"(":[0]}},{"match":null,"reference":false,"to":[],"label":null,"enclose":false,"typeChoices":{},"literalChoices":{}}],"start":0,"end":2,"name":"root"}},"printers":{"Expr":{"options":[[["items"],["(",{"repeat":{"key":"items","type":"Expr"}},")"]],[["value"],{"key":"value","type":"token"}]]},"root":{"repeat":{"key":"items","type":"Expr"}}},"replacements":{"Expr":["Expr"],"root":["root"]}};
	const definitionNames = ["Expr","root"];
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
