---
"@krapht/ork": minor
---

New: `ork register` attaches a project from outside its repository. Its
workflows, `project.yaml`, runs, lessons and agents live in
`~/.ork/projects/<id>/`, and Ork writes nothing into the repository; inside the
clone, `ork run <name>` finds them. An attached workflow reads the repository as
if it were in `.ork/workflows/`, so it can move in later unchanged.
`ork projects` lists registered projects (`forget` drops one, keeping its
files), and `ork init` now records the in-repo project.
