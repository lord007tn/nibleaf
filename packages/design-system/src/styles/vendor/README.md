# Vendored shadcn stylesheet

`shadcn-tailwind.css` is an unmodified, byte-for-byte copy of
`shadcn@4.20.1/dist/tailwind.css`. The adjacent `shadcn-LICENSE.md` preserves
the package's complete MIT license and copyright notice.

- Package: [`shadcn@4.20.1`](https://www.npmjs.com/package/shadcn/v/4.20.1)
- Published archive: <https://registry.npmjs.org/shadcn/-/shadcn-4.20.1.tgz>
- Source: [`shadcn-ui/ui`, `shadcn@4.20.1`](https://github.com/shadcn-ui/ui/tree/shadcn%404.20.1/packages/shadcn)
- Original stylesheet: `package/dist/tailwind.css` (16,041 bytes)
- Stylesheet SHA-256: `bc7d83425702955b4cb67cb14ede9d603f9d912376d57a2d81d661094d2a782a`
- Original license: `package/LICENSE.md`
- License SHA-256: `1564074e13439397221ffd522e2e504d56561994a23d371aa5e3ad43e4f5423f`

The shared stylesheet imports this local copy at the original import position.
This keeps all upstream theme rules, variants, utilities, and animations while
allowing the component-generation CLI and its tooling dependencies to be removed
from the application's dependencies. No CLI JavaScript is needed at runtime.

When updating, copy both files from the selected published package without
modifying their contents, update the version and hashes here, and verify the
application and admin CSS builds and representative component rendering.
