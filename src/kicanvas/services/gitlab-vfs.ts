/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import {
    based_on,
    basename,
    dirname,
    extension,
    normalize_join,
} from "../../base/paths";
import { GitLab, type GitLabURLInfo } from "./gitlab";
import { FileSystemBase, type FileEntry } from "./vfs";

/**
 * Virtual file system for GitLab.
 */
export class GitLabFileSystem extends FileSystemBase {
    private repo_paths = new Map<string, string>();

    /**
     * @param gl_repo - Parsed GitLab URL. `path` must be a directory, or the
     *      path to a single file if `single_file` is true.
     */
    constructor(
        private gl_repo: GitLabURLInfo,
        private single_file = false,
    ) {
        super();

        if (single_file) {
            // In single-file mode, just store the file basename.
            const path = gl_repo.path!;
            this.repo_paths.set(basename(path), path);
        }
    }

    private get ref() {
        return this.gl_repo.ref ?? "HEAD";
    }

    async load_file(path: string): Promise<File> {
        const repo_path = this.repo_paths.get(path);
        if (!repo_path) {
            throw new Error(`File ${path} not found!`);
        }

        const blob = await GitLab.get_raw_file(
            this.gl_repo.instance,
            this.gl_repo.project,
            repo_path,
            this.ref,
        );

        return new File([blob], basename(path));
    }

    async enumerate(cur_dir: string): Promise<FileEntry[]> {
        if (this.single_file) {
            return Array.from(this.repo_paths.keys()).map((path) => ({
                type: "file",
                path: path,
            }));
        }

        const base_dir = this.gl_repo.path ?? "";
        const full_path = normalize_join(base_dir, cur_dir);

        const contents = await GitLab.repos_contents(
            this.gl_repo.instance,
            this.gl_repo.project,
            full_path,
            this.ref,
        );

        const result: FileEntry[] = [];
        for (const it of contents) {
            const path = based_on(base_dir, it.path);

            if (it.type === "blob" && GitLabFileSystem.is_kicad_file(it.name)) {
                this.repo_paths.set(path, it.path);
                result.push({ type: "file", path: path });
            } else if (it.type === "tree") {
                result.push({ type: "directory", path: path });
            }
        }

        return result;
    }

    public static async fromURLs(
        url: string | URL,
    ): Promise<GitLabFileSystem | null> {
        const info = GitLab.parse_url(url);

        if (!info) {
            return null;
        }

        // Link to the root of a repo, treat it as a tree using HEAD.
        if (info.type === "root") {
            info.type = "tree";
            info.ref = "HEAD";
            info.path = "";
        }

        // If it's one file just load one file.
        let single_file = false;
        if (info.type === "blob") {
            const ext_name = extension(info.path!);
            if (["kicad_sch", "kicad_pcb"].includes(ext_name)) {
                single_file = true;
            } else if (ext_name.length !== 0) {
                // Link to non-kicad file, try using the containing directory.
                info.path = dirname(info.path!);
            }
        }

        return new GitLabFileSystem(info, single_file);
    }
}
