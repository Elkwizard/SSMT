export class FileContext {
	static ID = "ssmt-interactive-compiler";
	constructor(ext) {
		this.ext = ext;
		this.handle = null;
	}
	get filename() {
		return this.handle?.name;
	}
	async close() {
		this.handle = null;
	}
	async save(content, saveAs, basename = "untitled") {
		if (saveAs || !this.handle) {
			this.handle = await showSaveFilePicker({
				id: FileContext.ID,
				suggestedName: `${basename}.${this.ext}`
			});
		}

		const writable = await this.handle.createWritable();
		await writable.write(content);
		await writable.close();
	}
	async open() {
		[this.handle] = await showOpenFilePicker({
			id: FileContext.ID,
		});

		const reader = new FileReader();
		reader.readAsText(await this.handle.getFile(), "utf-8");
		await new Promise((resolve, reject) => {
			reader.addEventListener("load", resolve);
			reader.addEventListener("error", reject);
		});
		console.log(reader.result);
		return reader.result;
	}
}