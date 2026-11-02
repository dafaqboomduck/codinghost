async function boot() {
  renderHome();
  runner.start();
  const caps = await resolveCaps();
  dbg.log("caps", { sample: !!caps.sample, db: !!caps.db, user: !!caps.user });
  if (!caps.db) {
    S.blocked = window.claude && window.claude.use
      ? { title: "Sign in to save your progress", body: "CodingHost stores your plans and progress in your claude.ai account. Sign in to claude.ai and open this page again." }
      : { title: "Open this page in claude.ai", body: "CodingHost uses Claude to write exercises and saves your progress to your claude.ai account. Open this page in claude.ai while signed in." };
    renderHome();
    return;
  }
  let uid = null;
  try { uid = caps.user ? await caps.user.id() : null; } catch (e) { uid = null; }
  if (!uid) {
    S.blocked = { title: "Sign in to save your progress", body: "CodingHost keeps your plans private to your account, so it needs to know who you are. Sign in to claude.ai and open this page again." };
    renderHome();
    return;
  }
  // Viewers and Commenters cannot write, not even their own data/users subtree, and the server
  // rejects their writes as invalid_argument. Stop here instead of after a whole Claude generation.
  // null means the platform did not say, so let a refused write decide.
  let canWrite = null;
  try { canWrite = caps.user && caps.user.can ? await caps.user.can("data.write") : null; } catch (e) { canWrite = null; }
  dbg.log("access", { can_write: canWrite });
  if (canWrite === false) {
    S.blocked = { title: "You can only view this page", body: "Your access to this page is Viewer or Commenter, so CodingHost cannot save plans or progress for you. Ask the owner for Contributor access (or use Ask to edit), then reload." };
    renderHome();
    return;
  }
  S.caps = caps;
  S.uid = uid;
  store.init(caps.db, uid);
  dbg.attach(caps.db, uid);
  ai.init(caps.sample);
  await goHome();
}

boot();
