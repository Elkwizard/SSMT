import { clean } from "../core/clean.js";
import { evaluate } from "../core/evaluate.js";
import { parse } from "../grammar/parse.js";
import { highlight } from "https://elkwizard.github.io/TMHighlighter/html.js";
import { Theme } from "https://elkwizard.github.io/TMHighlighter/themes.js";
import tmSyntax from "../ssmt-language-support/syntaxes/ssmt.tmLanguage.json" with { type: "json" };
import { FileContext } from "./files.js";

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

let timerId = null;
const changeText = () => {
	if (timerId !== null) clearTimeout(timerId);
	timerId = setTimeout(updateOutput, 300);

	document.body.classList.add("unsaved");
	
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
		.trim()
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
		if (smtlibFile.filename) smtlibFile.save(smtlib, false);
	} catch (err) {
		compiledOutput = "";
		output.className = "error";
		const errText = innerWidth < 800 ? `${err.message}\n${err.stack}` : err.stack;
		output.innerHTML = applyANSIColors(escapeHTML(errText));
	}
};

addEventListener("input", changeText);

let notifyId = null;
const notify = (message, type = "success") => {
	const duration = {
		success: 1000,
		error: 5000
	}[type];

	const note = $("#notification");
	note.className = `visible ${type}`;
	note.textContent = message;

	if (notifyId !== null) clearTimeout(notifyId);
	notifyId = setTimeout(() => {
		note.classList.remove("visible");
	}, duration);
};

const handleTab = () => {
	const area = $("#input");

	const start = area.selectionStart;
	const end = area.selectionEnd;

	area.value = area.value.slice(0, start) + "\t" + area.value.slice(end);
	area.selectionStart = area.selectionEnd = start + 1;
	changeText();
};

const ssmtFile = new FileContext("ssmt");
const smtlibFile = new FileContext("smt2");

const syncFileNames = () => {
	$("#ssmtFileStatus").textContent = ssmtFile.filename ?? "";
	$("#smtFileStatus").textContent = smtlibFile.filename ?? "";
};

const syncFile = () => {
	document.body.classList.remove("unsaved");
	syncFileNames();
};

const saveFile = async saveAs => {
	try {
		await ssmtFile.save($("#input").value, saveAs);
		syncFile();
		notify("Saved!");
	} catch (err) {
		notify(`Failed to save: ${err}`, "error");
	}
};

const openFile = async () => {
	try {
		$("#input").value = await ssmtFile.open();
		await smtlibFile.close();
		changeText();
		document.body.classList.remove("unsaved");
		syncFile();
		notify(`Opened file '${ssmtFile.filename}'!`);
	} catch (err) {
		notify(`Failed to open file: ${err}`, "error");
	}
};

const setOutputFile = async () => {
	try {
		await smtlibFile.save(compiledOutput, true, ssmtFile.filename);
		syncFileNames();
		notify(`Connected to output file '${smtlibFile.filename}'!`);
	} catch (err) {
		notify(`Failed to connect to file: ${err}`, "error");
	}
};

const copyOutput = async () => {
	await navigator.clipboard.writeText(compiledOutput);
	notify("Copied!");
};

addEventListener("load", () => {
	$("#input").value = localStorage[LS_KEY] ?? "";

	$("#input").addEventListener("keydown", event => {
		if (event.key === "Tab") {
			event.preventDefault();
			handleTab();
		} else if (event.key.toLowerCase() === "s" && event.ctrlKey) {
			event.preventDefault();
			saveFile(event.shiftKey);
		} else if (event.key === "o" && event.ctrlKey) {
			event.preventDefault();
			openFile();
		}
	});

	$("#input").addEventListener("scroll", updateHighlightScroll);

	$("#saveButton").addEventListener("click", () => saveFile(false));
	$("#saveAsButton").addEventListener("click", () => saveFile(true));
	$("#openButton").addEventListener("click", openFile);
	
	$("#setOutputFile").addEventListener("click", setOutputFile);
	$("#copyOutput").addEventListener("click", copyOutput);

	changeText();
	updateOutput();
	syncFile();
});