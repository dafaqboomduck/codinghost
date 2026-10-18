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
  S.caps = caps;
  S.uid = uid;
  store.init(caps.db, uid);
  dbg.attach(caps.db, uid);
  ai.init(caps.sample);
  await goHome();
}

boot();
