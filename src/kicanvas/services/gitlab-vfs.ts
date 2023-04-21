/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { initiate_download } from "../../base/dom/download";
import { basename, extension } from "../../base/paths";
import { GitLab, GitLabUserContent } from "./gitlab";
import { VirtualFileSystem } from "./vfs";

const kicad_extensions = ["kicad_pcb", "kicad_pro", "kicad_sch"];
const gl_user_content = new GitLabUserContent();
const gl = new GitLab();

/**
 * Virtual file system for GitLab.
 */
export class GitLabFileSystem extends VirtualFileSystem {
    constructor(private files_to_urls: Map<string, URL>) {
        super();
    }

    public static async fromURLs(...urls: (string | URL)[]) {
        // Handles URLs like this:
        // https://gitlab.com/derme302/jellyfish-and-starfish/-/blob/main/hardware/jellyfish_tailboard/jellyfish_tailboard.kicad_pcb

        const files_to_urls = new Map();

        for (const url of urls) {
            const info = GitLab.parse_url(url);

            if (!info || !info.owner || !info.repo) {
                continue;
            }

            // Link to a single file.
            if (info.type == "blob") {
                const guc_url = gl_user_content.convert_url(url);
                const name = basename(guc_url);
                files_to_urls.set(name, guc_url);
            }

            // Link to a directory.
            else if (info.type == "tree") {
                // Get a list of files in the directory.
                const gl_file_list = (await gl.repos_contents(
                    info.owner,
                    info.repo,
                    info.path ?? "",
                    info.ref,
                )) as Record<string, string>[];

                for (const gl_file of gl_file_list) {
                    const name = gl_file["name"];
                    const download_url = gl_file["download_url"];
                    if (
                        !name ||
                        !download_url ||
                        !kicad_extensions.includes(extension(name))
                    ) {
                        continue;
                    }

                    files_to_urls.set(name, download_url);
                }
            }
        }

        return new GitLabFileSystem(files_to_urls);
    }

    public override *list() {
        yield* this.files_to_urls.keys();
    }

    public override get(name: string): Promise<File> {
        const url = this.files_to_urls.get(name);

        if (!url) {
            throw new Error(`File ${name} not found!`);
        }

        return gl_user_content.get(url);
    }

    public override has(name: string) {
        return Promise.resolve(this.files_to_urls.has(name));
    }

    public override async download(name: string) {
        // Note: we can't just use the GitLab URL to download since the anchor
        // tag method used by initiate_download() only works for same-origin
        // or data: urls, so this actually fetch()s the file and then initiates
        // the download.
        initiate_download(await this.get(name));
    }
}
