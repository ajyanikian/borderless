
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        service: "borderless-checkout"
      });
    }

    return env.ASSETS.fetch(request);
  }
};
