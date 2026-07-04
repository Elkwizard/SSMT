import { clean } from "../core/clean.js";
import { evaluate } from "../core/evaluate.js";
import { parse } from "../grammar/parse.js";
import { highlight } from "https://elkwizard.github.io/TMHighlighter/html.js";
import { Theme } from "https://elkwizard.github.io/TMHighlighter/themes.js";
import tmSyntax from "../ssmt-language-support/syntaxes/ssmt.tmLanguage.json" with { type: "json" };

const $ = document.querySelector.bind(document);

const escapeHTML = text => {
	const div = document.createElement("div");
	div.innerText = text;
	return div.innerHTML;
};

const applyANSIColors = ansi => {
	return ansi.replace(/(?:\x1b\[([^0]\d+)m(.*?))?\x1b\[0m/g, (_, color, text) => {
		if (!color) return "";
		return `<span style="background-color: red; color: white;">${text}</span>`;
	});
};

const THEME = new Theme({
	"comment": "#888",
	"constant": "#d85",
	"keyword": "#828",
	"storage": "#62e",
	"entity.name.function": "#373",
	"punctuation": "#888"
}, "#222");

const LS_KEY = "SSMT_Interactive_Compiler_Code";

const updateHighlight = () => {
	$("#highlighting").innerHTML = highlight(
		$("#input").value, tmSyntax, THEME
	);
};

const updateHighlightScroll = () => {
	$("#highlighting").scrollTop = $("#input").scrollTop;
	$("#highlighting").scrollLeft = $("#input").scrollLeft;
};

let compileWorker = null;
let compiledOutput = "";

const updateOutput = async () => {
	const code = $("#input").value;
	const inputs = $("#inputs").value
		.split(" ")
		.map(input => +input.trim());
	const logic = $("#logic").value;

	const ssmt = `logic ${logic} ${code}`;

	compileWorker?.terminate();
	compileWorker = new Worker("./compile.js", { type: "module" });
	
	await new Promise(resolve => compileWorker.addEventListener(
		"message", resolve, { once: true }
	));

	const output = $("#output");
	output.className = "compiling";
	output.innerText = "Compiling...";
	$("#prints").innerHTML = "";
	
	const compilation = new Promise((resolve, reject) => {
		compileWorker.addEventListener("message", event => {
			const message = event.data;

			if (message.type === "success") {
				resolve(message.smtlib);
			} else if (message.type === "error") {
				reject(message.error);
			} else if (message.type === "print") {
				const log = document.createElement("li");
				log.innerText = message.message;
				log.dataset.line = message.line;
				$("#prints").appendChild(log);
			}
		});
		
		compileWorker.postMessage({ ssmt, inputs });
	});

	try {
		const smtlib = await compilation;
		compiledOutput = smtlib;
		output.className = "output";
		output.innerText = smtlib;
		localStorage[LS_KEY] = code;
	} catch (err) {
		compiledOutput = "";
		output.className = "error";
		const errText = innerWidth < 800 ? `${err.message}\n${err.stack}` : err.stack;
		output.innerHTML = applyANSIColors(escapeHTML(errText));
	}
};

let timerId = null;
addEventListener("input", () => {
	updateHighlight();
	if (timerId !== null) clearTimeout(timerId);
	timerId = setTimeout(updateOutput, 300);
});

let notifyId = null;
const notify = (message, duration) => {
	const note = $("#notification");
	note.classList.add("visible");
	note.textContent = message;

	if (notifyId !== null) clearTimeout(notifyId);
	notifyId = setTimeout(() => {
		note.classList.remove("visible");
	}, duration);
};

addEventListener("load", () => {
	$("#input").value = localStorage[LS_KEY] ?? "";

	$("#input").addEventListener("keydown", event => {
		if (event.key !== "Tab") return;
		
		event.preventDefault();
		const area = $("#input");

		const start = area.selectionStart;
		const end = area.selectionEnd;

		area.value = area.value.slice(0, start) + "\t" + area.value.slice(end);
		area.selectionStart = area.selectionEnd = start + 1;
		updateHighlight();
	});

	$("#input").addEventListener("scroll", updateHighlightScroll);

	$("#copyOutput").addEventListener("click", () => {
		navigator.clipboard.writeText(compiledOutput);
		notify("Copied!", 1000);
	});

	updateHighlight();
	updateOutput();
});