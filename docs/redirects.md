# Redirects — learn-app

Old addresses and in-app path compatibility that must keep working. Checked on
the live domain after each deploy (DEPLOY.md).

## In-app legacy query params (P4)
The old website course pages used query params. These must keep working on the
`/courses/` route, redirected to the new path shape:
- `/courses/?teacher=<slug>` → filter courses by teacher
- `/courses/?topic=<topic>` → filter courses by topic
- `/courses/?q=<text>` → search

## New path shape (P4)
`/`, `/search?q=`, `/my`, `/more`, `/courses/<id>`, `/courses/<id>/<num>`,
`/teachers`, `/teachers/<slug>`.

## External
- `learn.84000.digital` is the public address; there is no workers.dev address.
- DNS and any website menu link to Learn are planned with the DNS chat / website
  chat; do not change DNS here.

(No external redirects are owned by this repo yet. This file is filled as the
DNS and website chats confirm them.)
