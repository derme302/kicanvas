/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { request_error_handler, UnknownError } from "./api-error";

export class GitLabURLInfo {
    /** Web base URL of the GitLab instance, e.g. `https://gitlab.com` */
    instance: string;
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
 * Client for the GitLab REST API v4.
 *
 * gitlab.com is always supported. A single self-hosted instance can be added
 * at runtime with `GitLab.set_custom_instance()`.
 */
export class GitLab {
    static readonly default_instance = "https://gitlab.com";
    static readonly accept_header = "application/json";
    static readonly page_size = 100;

    static #custom_instance: URL | null = null;

    /**
     * Sets the self-hosted GitLab instance that links will be accepted for, in
     * addition to gitlab.com. Pass null or an empty string to clear it.
     *
     * The instance may live under a subpath, e.g. `https://example.com/gitlab`.
     *
     * @returns false (and clears the instance) if `instance` isn't a valid
     *      http(s) URL.
     */
    static set_custom_instance(instance: string | null | undefined): boolean {
        GitLab.#custom_instance = null;

        if (!instance?.trim()) {
            return true;
        }

        try {
            const url = new URL(instance.trim());
            if (url.protocol !== "https:" && url.protocol !== "http:") {
                return false;
            }
            url.search = "";
            url.hash = "";
            url.pathname = url.pathname.replace(/\/+$/, "");
            GitLab.#custom_instance = url;
            return true;
        } catch {
            return false;
        }
    }

    /** Web base URLs (no trailing slash) of all supported instances */
    static get instances(): URL[] {
        const instances = [new URL(GitLab.default_instance)];
        if (GitLab.#custom_instance) {
            instances.push(GitLab.#custom_instance);
        }
        return instances;
    }

    /** REST API base URL for an instance's web base URL */
    static api_url(instance: string): string {
        return `${instance.replace(/\/+$/, "")}/api/v4/`;
    }

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
            parsed = new URL(url, GitLab.default_instance);
        } catch {
            return null;
        }

        if (parsed.hostname === "www.gitlab.com") {
            parsed.hostname = "gitlab.com";
        }

        // Find the instance this URL belongs to and strip its base path.
        let instance: string | undefined;
        let parts: string[] = [];
        for (const candidate of GitLab.instances) {
            if (parsed.origin !== candidate.origin) {
                continue;
            }
            const base_path = candidate.pathname.replace(/\/+$/, "");
            if (
                parsed.pathname !== base_path &&
                !parsed.pathname.startsWith(base_path + "/")
            ) {
                continue;
            }
            instance = candidate.origin + base_path;
            try {
                parts = parsed.pathname
                    .slice(base_path.length)
                    .split("/")
                    .filter((s) => s !== "")
                    .map((s) => decodeURIComponent(s));
            } catch {
                return null;
            }
            break;
        }

        if (instance === undefined) {
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
            return { instance, project, type: "root" };
        }

        const [kind, ref, ...path] = rest;
        if (!ref || (kind !== "tree" && kind !== "blob" && kind !== "raw")) {
            return null;
        }

        return {
            instance,
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
        instance: string,
        path: string,
        params?: Record<string, string>,
    ): Promise<Response> {
        const url = new URL(path, GitLab.api_url(instance));

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
        instance: string,
        path: string,
        params?: Record<string, string>,
    ): Promise<T> {
        const response = await GitLab.fetch(instance, path, params);
        return (await response.json()) as T;
    }

    /**
     * Lists the files and directories directly inside of `path`.
     *
     * API: https://docs.gitlab.com/ee/api/repositories.html#list-repository-tree
     */
    static async repos_contents(
        instance: string,
        project: string,
        path: string,
        ref: string,
    ): Promise<GitLabTreeResponse[]> {
        const results: GitLabTreeResponse[] = [];

        for (let page = 1; ; page++) {
            const entries = await GitLab.request_json<GitLabTreeResponse[]>(
                instance,
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
        instance: string,
        project: string,
        path: string,
        ref: string,
    ): Promise<Blob> {
        const response = await GitLab.fetch(
            instance,
            `${GitLab.project_path(project)}/repository/files/${encodeURIComponent(path)}/raw`,
            { ref: ref },
        );
        return await response.blob();
    }
}
