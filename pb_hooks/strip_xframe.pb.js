// Lets one site of yours (a dashboard, an app bar) show flock in an iframe,
// and no other.
//
// PocketBase sends X-Frame-Options: SAMEORIGIN on every response by default,
// which stops any other site from framing the app. This drops that header and
// sends CSP frame-ancestors instead, allowing flock itself, a local dev server
// (http://localhost on any port), and whatever FLOCK_FRAME_ANCESTORS names in
// PocketBase's environment: one or more origins, separated by spaces.
//
// PocketBase 0.23+ JS hook: middleware receives one RequestEvent `e` and must
// call `e.next()`. Handlers can't see this file's outer scope, so the policy
// is built inside the handler.
//
// Install: copy this file into <pocketbase-root>/pb_hooks/, which a container
// must mount at /pb/pb_hooks, set FLOCK_FRAME_ANCESTORS in PocketBase's
// environment, then restart PocketBase (hooks load only at startup). The log
// shows "[strip_xframe] loaded" once it is picked up.

console.log("[strip_xframe] loaded");

routerUse((e) => {
	const extra = $os.getenv("FLOCK_FRAME_ANCESTORS") || "";
	e.response.header().del("X-Frame-Options");
	e.response.header().set(
		"Content-Security-Policy",
		("frame-ancestors 'self' http://localhost:* " + extra).trim()
	);
	return e.next();
});
