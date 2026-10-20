export default {
  fetch(request, env) {
    // Service bindings stay within Cloudflare; the client never connects to workers.dev.
    return env.STATS.fetch(request);
  },
};
