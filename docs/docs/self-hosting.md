# Self-hosting

If you host your own copy of the KiCanvas standalone app, you can point it at a self-hosted GitLab instance so users can paste links to repositories on that instance. gitlab.com links always work.

Set the `gitlab-host` attribute on `<kc-kicanvas-shell>` to the base URL of your GitLab instance. This is read at runtime, so there is no need to rebuild KiCanvas:

```html
<kc-kicanvas-shell gitlab-host="https://git.example.com"></kc-kicanvas-shell>
```

If GitLab is served from a subpath, include it: `https://example.com/gitlab`.

Only one self-hosted instance is supported per deployment. Only public repositories can be loaded.

## Requirements

KiCanvas talks to GitLab's REST API (`<gitlab-host>/api/v4/`) directly from the browser, so:

- The instance must be reachable from the user's browser.
- The API must allow cross-origin requests from wherever KiCanvas is hosted (an `Access-Control-Allow-Origin` header on `/api/*`). GitLab normally does this by default, but a reverse proxy may strip it.
- If KiCanvas is served over HTTPS, so must GitLab, otherwise the browser blocks the requests.

## Limitations

- Branch or tag names containing `/` aren't supported in links.
- Private repositories aren't supported.
