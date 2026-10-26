/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { assert } from "chai";
import { GitLab } from "../../src/kicanvas/services/gitlab";
import { GitLabFileSystem } from "../../src/kicanvas/services/gitlab-vfs";

suite("kicanvas.services.gitlab", function () {
    suite("GitLab.parse_url()", function () {
        test("repo root", function () {
            const expected = {
                instance: "https://gitlab.com",
                project: "a/b",
                type: "root",
            };
            assert.deepEqual(
                GitLab.parse_url("https://gitlab.com/a/b"),
                expected,
            );
            assert.deepEqual(
                GitLab.parse_url("https://gitlab.com/a/b/"),
                expected,
            );
            assert.deepEqual(
                GitLab.parse_url("https://gitlab.com/a/b.git"),
                expected,
            );
        });

        test("tree and blob", function () {
            assert.deepEqual(
                GitLab.parse_url("https://gitlab.com/a/b/-/tree/main/x/y"),
                {
                    instance: "https://gitlab.com",
                    project: "a/b",
                    type: "tree",
                    ref: "main",
                    path: "x/y",
                },
            );
            assert.deepEqual(
                GitLab.parse_url("https://gitlab.com/a/b/-/tree/main"),
                {
                    instance: "https://gitlab.com",
                    project: "a/b",
                    type: "tree",
                    ref: "main",
                    path: "",
                },
            );
            assert.deepEqual(
                GitLab.parse_url(
                    "https://gitlab.com/a/b/-/blob/v1/x/c.kicad_sch",
                ),
                {
                    instance: "https://gitlab.com",
                    project: "a/b",
                    type: "blob",
                    ref: "v1",
                    path: "x/c.kicad_sch",
                },
            );
        });

        test("raw URLs are treated as blobs", function () {
            assert.deepEqual(
                GitLab.parse_url(
                    "https://gitlab.com/a/b/-/raw/main/c.kicad_pcb",
                ),
                {
                    instance: "https://gitlab.com",
                    project: "a/b",
                    type: "blob",
                    ref: "main",
                    path: "c.kicad_pcb",
                },
            );
        });

        test("nested groups", function () {
            assert.deepEqual(
                GitLab.parse_url("https://gitlab.com/g/s1/s2/r/-/tree/main/d"),
                {
                    instance: "https://gitlab.com",
                    project: "g/s1/s2/r",
                    type: "tree",
                    ref: "main",
                    path: "d",
                },
            );
            assert.deepEqual(GitLab.parse_url("https://gitlab.com/g/s1/r"), {
                instance: "https://gitlab.com",
                project: "g/s1/r",
                type: "root",
            });
        });

        test("legacy URLs without /-/", function () {
            assert.deepEqual(
                GitLab.parse_url(
                    "https://gitlab.com/a/b/blob/main/c.kicad_sch",
                ),
                {
                    instance: "https://gitlab.com",
                    project: "a/b",
                    type: "blob",
                    ref: "main",
                    path: "c.kicad_sch",
                },
            );
        });

        test("decodes percent-encoded paths", function () {
            assert.deepEqual(
                GitLab.parse_url("https://gitlab.com/a/b/-/tree/main/my%20dir"),
                {
                    instance: "https://gitlab.com",
                    project: "a/b",
                    type: "tree",
                    ref: "main",
                    path: "my dir",
                },
            );
        });

        test("rejects unsupported URLs", function () {
            assert.isNull(GitLab.parse_url("https://github.com/a/b"));
            assert.isNull(GitLab.parse_url("https://codeberg.org/a/b"));
            assert.isNull(GitLab.parse_url("https://gitlab.com/a"));
            assert.isNull(GitLab.parse_url("https://gitlab.com/a/b/-/issues"));
            assert.isNull(GitLab.parse_url("https://gitlab.com/a/b/-/tree"));
        });
    });

    suite("self-hosted instance", function () {
        teardown(function () {
            GitLab.set_custom_instance(null);
        });

        test("rejects hosts that aren't configured", function () {
            assert.isNull(GitLab.parse_url("https://git.example.com/a/b"));
        });

        test("accepts the configured host as well as gitlab.com", function () {
            assert.isTrue(
                GitLab.set_custom_instance("https://git.example.com"),
            );
            assert.deepEqual(
                GitLab.parse_url("https://git.example.com/g/s/r/-/tree/main/d"),
                {
                    instance: "https://git.example.com",
                    project: "g/s/r",
                    type: "tree",
                    ref: "main",
                    path: "d",
                },
            );
            assert.equal(
                GitLab.parse_url("https://gitlab.com/a/b")!.instance,
                "https://gitlab.com",
            );
        });

        test("supports ports and subpaths", function () {
            GitLab.set_custom_instance("http://localhost:8080/gitlab/");
            assert.deepEqual(
                GitLab.parse_url(
                    "http://localhost:8080/gitlab/a/b/-/blob/m/c.kicad_sch",
                ),
                {
                    instance: "http://localhost:8080/gitlab",
                    project: "a/b",
                    type: "blob",
                    ref: "m",
                    path: "c.kicad_sch",
                },
            );
            // Outside the subpath, or a different port.
            assert.isNull(GitLab.parse_url("http://localhost:8080/other/a/b"));
            assert.isNull(GitLab.parse_url("http://localhost:9090/gitlab/a/b"));
        });

        test("a subpath doesn't match a longer sibling path", function () {
            GitLab.set_custom_instance("https://example.com/gitlab");
            assert.isNull(GitLab.parse_url("https://example.com/gitlabx/a/b"));
        });

        test("rejects invalid or non-http values", function () {
            assert.isFalse(GitLab.set_custom_instance("not a url"));
            assert.isFalse(GitLab.set_custom_instance("ftp://example.com"));
            assert.isNull(GitLab.parse_url("https://git.example.com/a/b"));
        });

        test("empty value clears the instance", function () {
            GitLab.set_custom_instance("https://git.example.com");
            assert.isTrue(GitLab.set_custom_instance(""));
            assert.isNull(GitLab.parse_url("https://git.example.com/a/b"));
        });

        test("API requests go to the configured instance", async function () {
            const original_fetch = window.fetch;
            const requests: URL[] = [];
            window.fetch = async (input: RequestInfo | URL) => {
                requests.push(
                    new URL(
                        input instanceof Request ? input.url : input.toString(),
                    ),
                );
                return new Response("[]", {
                    headers: { "content-type": "application/json" },
                });
            };

            try {
                GitLab.set_custom_instance("https://example.com/gitlab");
                const vfs = await GitLabFileSystem.fromURLs(
                    "https://example.com/gitlab/g/r",
                );
                await vfs!.setup();
                assert.equal(
                    requests[0]!.pathname,
                    "/gitlab/api/v4/projects/g%2Fr/repository/tree",
                );
                assert.equal(requests[0]!.origin, "https://example.com");
            } finally {
                window.fetch = original_fetch;
            }
        });
    });

    suite("GitLabFileSystem", function () {
        const original_fetch = window.fetch;
        let requests: URL[];

        const tree = [
            { name: "sub", type: "tree", path: "hw/sub" },
            { name: "a.kicad_sch", type: "blob", path: "hw/a.kicad_sch" },
            { name: "README.md", type: "blob", path: "hw/README.md" },
        ];

        setup(function () {
            requests = [];
            window.fetch = async (input: RequestInfo | URL) => {
                const url = new URL(
                    input instanceof Request ? input.url : input.toString(),
                );
                requests.push(url);

                if (url.pathname.endsWith("/repository/tree")) {
                    return new Response(JSON.stringify(tree), {
                        headers: { "content-type": "application/json" },
                    });
                }
                if (url.pathname.endsWith("/raw")) {
                    return new Response("(kicad_sch)");
                }
                return new Response("", { status: 404 });
            };
        });

        teardown(function () {
            window.fetch = original_fetch;
        });

        test("lists kicad files in a directory", async function () {
            const vfs = await GitLabFileSystem.fromURLs(
                "https://gitlab.com/g/s/r/-/tree/main/hw",
            );
            assert.isNotNull(vfs);
            await vfs!.setup();

            assert.deepEqual([...vfs!.list()], ["a.kicad_sch"]);
            const url = requests[0]!;
            assert.equal(
                url.pathname,
                "/api/v4/projects/g%2Fs%2Fr/repository/tree",
            );
            assert.equal(url.searchParams.get("ref"), "main");
            assert.equal(url.searchParams.get("path"), "hw");
        });

        test("downloads a file", async function () {
            const vfs = await GitLabFileSystem.fromURLs(
                "https://gitlab.com/g/s/r/-/tree/main/hw",
            );
            await vfs!.setup();

            const file = await vfs!.get("a.kicad_sch");
            assert.equal(file.name, "a.kicad_sch");
            assert.equal(await file.text(), "(kicad_sch)");
            assert.equal(
                requests.at(-1)!.pathname,
                "/api/v4/projects/g%2Fs%2Fr/repository/files/hw%2Fa.kicad_sch/raw",
            );
        });

        test("single file links don't list the tree", async function () {
            const vfs = await GitLabFileSystem.fromURLs(
                "https://gitlab.com/g/r/-/blob/main/hw/a.kicad_sch",
            );
            await vfs!.setup();

            assert.deepEqual([...vfs!.list()], ["a.kicad_sch"]);
            assert.equal(requests.length, 0);
            const file = await vfs!.get("a.kicad_sch");
            assert.equal(await file.text(), "(kicad_sch)");
        });

        test("repo root uses HEAD", async function () {
            const vfs = await GitLabFileSystem.fromURLs(
                "https://gitlab.com/g/r",
            );
            await vfs!.setup();

            assert.equal(requests[0]!.searchParams.get("ref"), "HEAD");
            assert.equal(requests[0]!.searchParams.get("path"), "");
        });
    });
});
