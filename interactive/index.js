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
	return ansi.replace(/(?:\x1b\[(\d+)m(.*?))?\x1b\[0m/g, (_, color, text) => {
		if (!color) return "";
		return `<span style="background-color: red; color: white;">${text}</span>`;
	});
}

let compiledOutput = "";

const updateOutput = () => {
	const code = $("#input").value;
	const inputs = $("#inputs").value
		.split(" ")
		.map(input => +input.trim());
	const logic = $("#logic").value;

	try {
		const root = clean(parse(`logic ${logic}\n${code}`));
		const { smtlib } = evaluate(root, inputs);
		compiledOutput = smtlib;
		$("#output").className = "output";
		$("#output").innerText = smtlib;
	} catch (err) {
		compiledOutput = "";
		$("#output").className = "error";
		$("#output").innerHTML = applyANSIColors(escapeHTML(err.stack));
	}
};

let timerId = null;
addEventListener("input", () => {
	if (timerId !== null) clearTimeout(timerId);
	timerId = setTimeout(updateOutput, 300);
});

addEventListener("load", () => {
	$("#input").focus();

	$("#copyOutput").addEventListener("click", () => {
		navigator.clipboard.writeText(compiledOutput);
		alert("Copied!");
	});
});