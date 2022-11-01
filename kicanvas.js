import * as parser from "./parser.js";
import * as types from "./types.js";
import * as render from "./render.js";

const default_dialog_template = `
<dialog class="kicanvas-dialog">
    <form method="dialog">
        <div class="properties">
            <template>
                <div class="property">
                    <label data-bind data-bind-inner-text="key" data-bind-html-for="key"></label>
                    <input type="text" readonly data-bind data-bind-id="key" data-bind-name="key" data-bind-value="value" />
                </div>
            </template>
        </div>
        <button>Close</button>
    </form>
</dialog>
`;

export class KiCanvas {
    static init() {
        for (const e of document.querySelectorAll("[data-kicanvas]")) {
            const kicanvas = new KiCanvas(e);
            kicanvas.load_schematic();
        }
    }

    constructor(container) {
        this.ui = {
            container: container,
            dialog_template: document.getElementById(
                container.dataset.dialogTemplate
            ),
            canvas: document.createElement("canvas"),
            highlight_all_button: container.querySelector(
                "[data-highlight-all]"
            ),
        };

        if (!this.ui.dialog_template) {
            this.ui.dialog_template = document.createElement("template");
            this.ui.dialog_template.innerHTML = default_dialog_template;
        }

        this.ui.container.appendChild(this.ui.canvas);
        this.ui.canvas.addEventListener("mousedown", (e) => this.onclick(e));
        if (this.ui.highlight_all_button) {
            this.ui.highlight_all_button.addEventListener("click", () => {
                this.highlight_all();
            });
        }

        this.renderer = new render.Renderer(this.ui.canvas);
        this.selected = [];
    }

    async load_schematic(src) {
        src = src || this.ui.container.dataset.src;
        const text = await (await window.fetch(src)).text();
        const parsed = parser.parse(text);
        this.sch = new types.KicadSch(parsed);

        const sch_bb = this.renderer.bbox(this.sch);
        sch_bb.grow(2);

        this.renderer.fit_to_bbox(sch_bb);

        this.bboxes = this.renderer.interactive_bboxes(this.sch);
        for (const bb of this.bboxes) {
            bb.grow(2);
        }

        this.draw();
    }

    draw() {
        window.requestAnimationFrame(() => {
            this.renderer.clear();
            this.renderer.draw(this.sch);
            this.renderer.ctx.shadowColor = this.renderer.style.highlight;
            this.renderer.ctx.shadowBlur = 10;
            for (const selected of this.selected) {
                this.renderer.draw(selected.context);
            }
            this.renderer.ctx.shadowColor = "transparent";
        });
    }

    highlight_all() {
        this.selected = this.bboxes.slice();
        this.draw();
    }

    onclick(e) {
        const p = this.renderer.screen_space_to_world_space(
            e.clientX,
            e.clientY
        );

        this.selected = [];
        for (const b of this.bboxes) {
            if (b.contains_point(p.x, p.y)) {
                this.selected = [b];
                break;
            }
        }

        this.draw();

        if (this.selected) {
            this.show_dialog(this.selected[0].context);
        }
    }

    show_dialog(sym) {
        // create an empty dialog
        if (this.ui.dialog) {
            this.ui.dialog.remove();
        }

        const dialog =
            this.ui.dialog_template.content.firstElementChild.cloneNode(true);
        this.ui.dialog = dialog;
        window.document.body.appendChild(dialog);

        console.log(dialog);
        dialog.dataset.for = this.ui.container.id;

        // get all the properties and sort them
        const props = Object.values(sym.properties);
        props.sort((a, b) => a.n - b.n);

        // add them to the dialog
        const prop_tmpl = dialog.querySelector("template");

        for (const p of props) {
            // Behold, the dumbest databinding ever.
            const e = prop_tmpl.content.cloneNode(true);
            for (const b of e.querySelectorAll("[data-bind]")) {
                for (let [target, source] of Object.entries(b.dataset)) {
                    if (!target.startsWith("bind") || target == "bind") {
                        continue;
                    }
                    target = target.slice(4);
                    target = target.slice(0, 1).toLowerCase() + target.slice(1);
                    b[target] = p[source];
                }
            }
            prop_tmpl.parentNode.appendChild(e);
        }

        // show the dialog
        dialog.showModal();
    }
}
