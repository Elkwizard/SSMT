import { clean } from "../core/clean.js";
import { evaluate } from "../core/evaluate.js";
import { parse } from "../grammar/parse.js";

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
}

let compileWorker = null;
let compiledOutput = "";

const updateOutput = async () => {
	const code = $("#input").value;
	const inputs = $("#inputs").value
		.split(" ")
		.map(input => +input.trim());
	const logic = $("#logic").value;

	const ssmt = `logic ${logic}\n${code}`;

	compileWorker?.terminate();
	compileWorker = new Worker("./compile.js", { type: "module" });
	
	await new Promise(resolve => compileWorker.addEventListener(
		"message", resolve, { once: true }
	));

	const output = $("#output");
	output.className = "compiling";
	output.innerText = "Compiling...";
	
	const compilation = new Promise((resolve, reject) => {
		compileWorker.addEventListener("message", event => {
			const message = event.data;

			if (message.type === "success") {
				resolve(message.smtlib);
			} else {
				reject(message.error);
			}
		}, { once: true });
		
		compileWorker.postMessage({ ssmt, inputs });
	});

	try {
		const smtlib = await compilation;
		compiledOutput = smtlib;
		output.className = "output";
		output.innerText = smtlib;
	} catch (err) {
		compiledOutput = "";
		output.className = "error";
		const errText = innerWidth < 800 ? `${err.message}\n${err.stack}` : err.stack;
		output.innerHTML = applyANSIColors(escapeHTML(errText));
	}
};

let timerId = null;
addEventListener("input", () => {
	if (timerId !== null) clearTimeout(timerId);
	timerId = setTimeout(updateOutput, 300);
});

addEventListener("load", () => {
	$("#input").focus();

	$("#input").addEventListener("keydown", event => {
		if (event.key !== "Tab") return;
		
		event.preventDefault();
		const area = $("#input");

		const start = area.selectionStart;
		const end = area.selectionEnd;

		area.value = area.value.slice(0, start) + "\t" + area.value.slice(end);
		area.selectionStart = area.selectionEnd = start + 1;
	});

	$("#copyOutput").addEventListener("click", () => {
		navigator.clipboard.writeText(compiledOutput);
		alert("Copied!");
	});

	updateOutput();
});