import cytoscape from "cytoscape";
import { exportSvg, exportPdf, exportPng } from "cytoscape-graphics-export";

document.body.innerHTML = `<style>body{font:16px sans-serif;margin:24px}#graph{width:900px;height:500px;border:1px solid #ccc}button{margin:12px 8px 12px 0}label{display:block;margin:8px 0}</style>
<h1>Cytoscape Graphics Export</h1><div id="graph"></div>
<label>Roboto normal TTF <input id="normal" type="file" accept=".ttf"></label>
<label>Roboto italic TTF <input id="italic" type="file" accept=".ttf"></label>
<button data-format="svg">Full SVG</button><button data-format="svg" data-area="true">Area SVG</button>
<button data-format="pdf">Full PDF</button><button data-format="pdf" data-area="true">Area PDF</button><button data-format="png">Full PNG</button><button data-format="png" data-area="true">Area PNG</button><span id="status"></span>`;
const cy = cytoscape({
	container: document.getElementById("graph"),
	elements: [
		{ data: { id: "a", label: "Узел А" }, position: { x: 150, y: 150 } },
		{ data: { id: "b", label: "Node B" }, position: { x: 450, y: 300 } },
		{ data: { id: "ab", source: "a", target: "b" } },
	],
	layout: { name: "preset" },
	style: [
		{
			selector: "node",
			style: {
				label: "data(label)",
				shape: "round-rectangle",
				width: 90,
				height: 60,
				"background-color": "#36a",
				color: "#222",
				"font-size": 18,
			},
		},
		{
			selector: "edge",
			style: {
				"line-color": "#777",
				"line-style": "dashed",
				"target-arrow-shape": "triangle",
				"curve-style": "bezier",
			},
		},
	],
});
const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
for (const button of buttons)
	button.onclick = async () => {
		buttons.forEach((b) => {
			b.disabled = true;
		});
		const status = document.getElementById("status")!;
		status.textContent = "Exporting…";
		// Let the browser paint the busy state before synchronous drawing.
		await new Promise((resolve) =>
			requestAnimationFrame(() => setTimeout(resolve, 0)),
		);
		try {
			const area = button.dataset.area
				? { x: 50, y: 50, w: 600, h: 350 }
				: undefined;
			const start = performance.now();
			let blob: Blob;
			if (button.dataset.format === "pdf") {
				const normal = (document.getElementById("normal") as HTMLInputElement)
					.files?.[0];
				const italic = (document.getElementById("italic") as HTMLInputElement)
					.files?.[0];
				if (!normal || !italic)
					throw new Error("Choose both Roboto TTF files first");
				blob = await exportPdf(cy, {
					area,
					fonts: {
						family: "Roboto",
						normal: await normal.arrayBuffer(),
						italic: await italic.arrayBuffer(),
					},
				});
			} else if (button.dataset.format === "png") {
				blob = await exportPng(cy, { area });
			} else blob = await exportSvg(cy, { area });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `example.${button.dataset.format}`;
			link.click();
			setTimeout(() => URL.revokeObjectURL(url), 60000);
			status.textContent = `${Math.round(performance.now() - start)} ms; ${blob.size} bytes`;
		} catch (error) {
			status.textContent = String(error);
		} finally {
			buttons.forEach((b) => {
				b.disabled = false;
			});
		}
	};
