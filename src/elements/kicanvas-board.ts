/*
    Copyright (c) 2022 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { html, CustomElement } from "../dom/custom-elements";
import { KiCanvasLoadEvent } from "../framework/events";
import { BoardViewer } from "../board/viewer";

export class KiCanvasBoardElement extends CustomElement {
    #canvas: HTMLCanvasElement;
    viewer: BoardViewer;
    selected: any[] = [];

    get loaded() {
        return this.getBooleanAttribute("loaded");
    }

    set loaded(value) {
        this.setBooleanAttribute("loaded", value);
    }

    override initialContentCallback() {
        const src = this.getAttribute("src");
        if (src) {
            this.load(src);
        }
    }

    override disconnectedCallback() {
        this.viewer?.dispose();
        this.selected = [];
    }

    async load(src: File | string) {
        this.viewer = new BoardViewer(this.#canvas);

        await this.viewer.setup();
        await this.viewer.load(src);

        this.loaded = true;
        this.dispatchEvent(new KiCanvasLoadEvent());

        this.viewer.draw_soon();
    }

    override render() {
        this.#canvas = html`<canvas></canvas>` as HTMLCanvasElement;

        return html` <style>
                :host {
                    display: block;
                    touch-action: none;
                }

                canvas {
                    width: 100%;
                    height: 100%;
                }
            </style>
            ${this.#canvas}`;
    }
}

window.customElements.define("kicanvas-board", KiCanvasBoardElement);
