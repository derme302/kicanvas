/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { request_error_handler, UnknownError } from "./api-error";

export class GitLabURLInfo {
    /** Full project path, including any subgroups, e.g. `group/subgroup/repo` */
    project: string;
    type: "root" | "tree" | "blob";
    ref?: string;
    path?: string;
}

/** An entry returned by the repository tree API. */
export class GitLabTreeResponse {
    id: string;
    name: string;
    type: "tree" | "blob" | "commit";
    path: string;
    mode: string;
}

/**
 * Client for the GitLab (gitlab.com) REST API v4.
 *
 * Only gitlab.com is supported. Self-hosted instances are not.
 */
export class GitLab {
    static readonly host_names = ["gitlab.com", "www.gitlab.com"];
    static readonly html_base_url = "https://gitlab.com/";
    static readonly base_url = "https://gitlab.com/api/v4/";
    static readonly accept_header = "application/json";
    static readonly page_size = 100;

    /**
     * Parse an html (user-facing) URL
     *
     * Handles URLs like:
     * - https://gitlab.com/group/repo
     * - https://gitlab.com/group/subgroup/repo/-/tree/main/some/dir
     * - https://gitlab.com/group/repo/-/blob/main/dir/file.kicad_sch
     * - https://gitlab.com/group/repo/-/raw/main/dir/file.kicad_sch
     * - https://gitlab.com/group/repo/blob/main/dir/file.kicad_sch (legacy)
     *
     * Note that refs containing slashes are not supported, since there's no
     * way to tell where the ref ends and the path begins from the URL alone.
     */
    static parse_url(url: string | URL): GitLabURLInfo | null {
        let parsed: URL;
        try {
            parsed = new URL(url, GitLab.html_base_url);
        } catch {
            return null;
        }

        if (!GitLab.host_names.includes(parsed.hostname)) {
            return null;
        }

        let parts: string[];
        try {
            parts = parsed.pathname
                .split("/")
                .filter((s) => s !== "")
                .map((s) => decodeURIComponent(s));
        } catch {
            return null;
        }

        // GitLab separates the project path from the rest with "/-/". Older
        // URLs omit it, in which case look for the first tree/blob/raw segment.
        let sep = parts.indexOf("-");
        if (sep === -1) {
            sep = parts.findIndex(
                (p, i) =>
                    i >= 2 && (p === "tree" || p === "blob" || p === "raw"),
            );
        }

        const project_parts = sep === -1 ? parts : parts.slice(0, sep);
        const rest =
            sep === -1 ? [] : parts.slice(sep + (parts[sep] === "-" ? 1 : 0));

        if (project_parts.length < 2) {
            return null;
        }

        const project = project_parts.join("/").replace(/\.git$/, "");

        if (rest.length === 0) {
            return { project, type: "root" };
        }

        const [kind, ref, ...path] = rest;
        if (!ref || (kind !== "tree" && kind !== "blob" && kind !== "raw")) {
            return null;
        }

        return {
            project,
            type: kind === "tree" ? "tree" : "blob",
            ref,
            path: path.join("/"),
        };
    }

    /** API path prefix for a project, e.g. `projects/group%2Frepo` */
    static project_path(project: string): string {
        return `projects/${encodeURIComponent(project)}`;
    }

    private static async fetch(
        path: string,
        params?: Record<string, string>,
    ): Promise<Response> {
        const url = new URL(path, GitLab.base_url);

        if (params) {
            url.search = new URLSearchParams(params).toString();
        }

        const response = await fetch(
            new Request(url, {
                method: "GET",
                headers: { Accept: GitLab.accept_header },
            }),
        );

        await request_error_handler(response);

        if (!response.ok) {
            throw new UnknownError(
                response.url,
                `${response.status} ${response.statusText}`,
                response,
            );
        }

        return response;
    }

    static async request_json<T>(
        path: string,
        params?: Record<string, string>,
    ): Promise<T> {
        const response = await GitLab.fetch(path, params);
        return (await response.json()) as T;
    }

    /**
     * Lists the files and directories directly inside of `path`.
     *
     * API: https://docs.gitlab.com/ee/api/repositories.html#list-repository-tree
     */
    static async repos_contents(
        project: string,
        path: string,
        ref: string,
    ): Promise<GitLabTreeResponse[]> {
        const results: GitLabTreeResponse[] = [];

        for (let page = 1; ; page++) {
            const entries = await GitLab.request_json<GitLabTreeResponse[]>(
                `${GitLab.project_path(project)}/repository/tree`,
                {
                    path: path,
                    ref: ref,
                    per_page: GitLab.page_size.toString(),
                    page: page.toString(),
                },
            );

            results.push(...entries);

            if (entries.length < GitLab.page_size) {
                return results;
            }
        }
    }

    /**
     * Downloads the raw contents of the file at `path`.
     *
     * API: https://docs.gitlab.com/ee/api/repository_files.html#get-raw-file-from-repository
     */
    static async get_raw_file(
        project: string,
        path: string,
        ref: string,
    ): Promise<Blob> {
        const response = await GitLab.fetch(
            `${GitLab.project_path(project)}/repository/files/${encodeURIComponent(path)}/raw`,
            { ref: ref },
        );
        return await response.blob();
    }
}
