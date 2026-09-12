// spec/80 [update] check: the new-version lookup never runs under test — no
// suite may depend on the npm registry being reachable, and no golden may
// carry the line. Mirrors packages/python/tests/conftest.py.
process.env["BRAINPICK_UPDATE_CHECK"] ??= "false";
