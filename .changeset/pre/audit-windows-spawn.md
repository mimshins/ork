---
"@krapht/ork": patch
---

The security audit's advisory scanner runs `npm audit` and `pnpm audit` on
Windows, through a shell as their `.cmd` shims need.
