export class FileContext {
	static ID = "ssmt-interactive-compiler";
	constructor() {
		this.handle = null;
	}
	get filename() {
		return this.handle?.name;
	}
	async save(content, saveAs) {
		if (saveAs || !this.handle) {
			this.handle = await showSaveFilePicker({
				id: FileContext.ID,
				suggestedName: "untitled.ssmt"
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