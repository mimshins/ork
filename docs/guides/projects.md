# Projects: in your repository, or beside it

Ork keeps a folder of its own for each project: your workflows, your
[project rules](./project-rules.md), each run's files, lessons, and your own
agents. That folder is either in your repository or outside it.

- **In the repository** (`ork init`): `.ork/`, committed with your code, so your
  process is reviewed like code.
- **Beside it** (`ork register`): `~/.ork/projects/<id>/`. Ork writes nothing
  into your repository: no `.ork/`, no links, no `.gitignore` entries. Use this
  for a project with its own process that should not change for Ork, or one you
  only try Ork on.

## Contents

- [Registering a project from outside](./projects/attached-projects.md)
  - [Registering a project from outside](./projects/attached-projects.md#registering-a-project-from-outside)
  - [Paths in an attached workflow](./projects/attached-projects.md#paths-in-an-attached-workflow)
  - [Listing, moving and forgetting](./projects/attached-projects.md#listing-moving-and-forgetting)
  - [Keeping Ork out of your repository's knowledge](./projects/attached-projects.md#keeping-ork-out-of-your-repositorys-knowledge)
- [Moving into the repository, and drafting a workflow](./projects/moving-into-the-repository.md)
  - [Moving into the repository](./projects/moving-into-the-repository.md#moving-into-the-repository)
  - [Drafting a workflow from your agents](./projects/moving-into-the-repository.md#drafting-a-workflow-from-your-agents)
- [A worked example: a project with its own process](./projects/a-worked-example.md)
