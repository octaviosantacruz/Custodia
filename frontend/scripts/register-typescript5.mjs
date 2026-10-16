import { register } from 'node:module';

/* Registers the TypeScript 5 redirect for the generator process; see
   typescript5-resolver.mjs for why it exists. */
register(new URL('./typescript5-resolver.mjs', import.meta.url));
