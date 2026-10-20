import { relay } from './handler.mjs';

Deno.serve(request => relay(request));
