// Lets Nexus (https://nexus.example.com) show flock in an iframe, and
// no other site.
//
// PocketBase sends X-Frame-Options: SAMEORIGIN on every response by default,
// which stops any other site from framing the app. This drops that header and
// sends CSP frame-ancestors instead, allowing flock itself, Nexus, and
// Nexus's local dev server (http://localhost on any port).
//
// PocketBase 0.23+ JS hook: middleware receives one RequestEvent `e` and must
// call `e.next()`. Handlers can't see this file's outer scope, so the policy
// string stays inline.
//
// Install: copy this file into <pocketbase-root>/pb_hooks/, which the container
// must mount at /pb/pb_hooks, then restart PocketBase (hooks load only at
// startup). The log shows "[strip_xframe] loaded" once it is picked up.

console.log("[strip_xframe] loaded");

routerUse((e) => {
	e.response.header().del("X-Frame-Options");
	e.response.header().set(
		"Content-Security-Policy",
		"frame-ancestors 'self' https://nexus.example.com http://localhost:*"
	);
	return e.next();
});
