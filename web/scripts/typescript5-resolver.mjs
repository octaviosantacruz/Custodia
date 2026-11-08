/* FE-API-001: openapi-typescript 7 imports the TypeScript 5 compiler API
   (`ts.factory`) to render its AST; this repo builds with TypeScript 7, whose
   JS surface no longer exposes that API. This resolver redirects that single
   bare import to the `typescript5` devDependency alias so the generator runs
   with the compiler it needs, without downgrading the project's TypeScript.
   It is registered only for the generator process (register-typescript5.mjs);
   `tsc`, Vite and the rest of the frontend keep TypeScript 7. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'typescript') return nextResolve('typescript5', context);
  return nextResolve(specifier, context);
}
