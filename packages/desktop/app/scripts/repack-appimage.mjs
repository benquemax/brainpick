#!/usr/bin/env node
/**
 * Strip the poison, repack the AppImage (tester-zero, 2026-07-12).
 *
 * linuxdeploy's GTK plugin bundles the BUILD distro's platform libraries
 * (~155 of them: libwayland-*, libgst*, libglib, the GTK stack). Tauri never
 * bundles WebKit — it is a REQUIRED system dependency — so at runtime
 * LD_LIBRARY_PATH feeds those elderly libs to the host's (often newer)
 * WebKit, whose GPU process dies: `Could not create default EGL display:
 * EGL_BAD_PARAMETER` → abort or a white window. Proven live on Arch/GNOME:
 * quarantining every bundled lib made the released AppImage run cleanly on
 * pure system libs — exactly like the dev build always did.
 *
 * So: extract → empty usr/lib down to the Brainpick resources (allowlist,
 * not a poison pattern — the first denylist draft missed io-wmf.so and four
 * whole module trees) → neutralize the GTK apprun hook's module-cache env
 * exports, which are the other channel feeding old-ABI modules to system
 * GTK → repack. The resulting AppImage requires system webkit2gtk — which
 * Tauri requires on every distro anyway (it is the documented Linux
 * prerequisite, not a new demand). The delivery mechanism for the bundled
 * libs was the binary's linuxdeploy-patched rpath ($ORIGIN/../lib): an
 * emptied usr/lib defuses it with no patching needed.
 *
 * Usage: node repack-appimage.mjs <path-to.AppImage> [appimagetool]
 * (appimagetool: path to the tool, else $APPIMAGETOOL, else auto-download
 * of the continuous release into the script's cache dir.)
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const APPIMAGETOOL_URL =
  "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage";

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", ...opts });
}

function sizeOf(path) {
  let total = 0;
  const walk = (p) => {
    // lstat: usr/lib is full of symlinks (im-*.so → module trees), some
    // dangling once their target tree is already stripped — never follow.
    const st = lstatSync(p);
    if (st.isDirectory()) for (const entry of readdirSync(p)) walk(join(p, entry));
    else total += st.size;
  };
  walk(path);
  return total;
}

function main() {
  const appimage = resolve(process.argv[2] ?? "");
  if (!appimage || !existsSync(appimage)) {
    console.error("usage: repack-appimage.mjs <path-to.AppImage> [appimagetool]");
    process.exit(1);
  }
  const workDir = dirname(appimage);
  const extractDir = join(workDir, "squashfs-root");
  rmSync(extractDir, { recursive: true, force: true });

  console.log(`→ extracting ${appimage}`);
  // --appimage-extract needs no FUSE; run from workDir so squashfs-root lands there.
  sh(appimage, ["--appimage-extract"], { cwd: workDir });

  // ALLOWLIST: only the Brainpick resources dir may live in usr/lib. Every
  // other entry — top-level libs, pixbuf/gio/gtk/webkit module trees,
  // whatever linuxdeploy grows next — is the build distro's platform and
  // goes. (The denylist draft of this loop shipped io-wmf.so.)
  const libDir = join(extractDir, "usr", "lib");
  let removed = 0;
  let removedBytes = 0;
  for (const entry of readdirSync(libDir)) {
    if (entry === "Brainpick") continue;
    const full = join(libDir, entry);
    removedBytes += sizeOf(full);
    rmSync(full, { recursive: true, force: true });
    removed += 1;
  }
  console.log(`→ stripped ${removed} bundled entries (${(removedBytes / 1e6).toFixed(0)} MB) — system webkit2gtk/GTK will be used, as Tauri requires anyway`);

  // The GTK apprun hook is the other poison channel: it exports module-cache
  // paths (GDK_PIXBUF_MODULE_FILE, GIO_EXTRA_MODULES, GTK_PATH, schema dirs)
  // into the AppDir we just emptied. Replace it — same filename, AppRun
  // `source`s it by name — keeping only what is system-neutral: the
  // dark-theme sniff and Tauri's own GDK_BACKEND=x11 Wayland-crash
  // workaround (tauri-apps/tauri#8541).
  const hook = join(extractDir, "apprun-hooks", "linuxdeploy-plugin-gtk.sh");
  if (existsSync(hook)) {
    writeFileSync(
      hook,
      [
        "#! /usr/bin/env bash",
        "# Neutralized by repack-appimage.mjs: system GTK/WebKit only — no",
        "# bundled modules, caches, or schemas (they were stripped anyway).",
        'gsettings get org.gnome.desktop.interface gtk-theme 2> /dev/null | grep -qi "dark" && GTK_THEME_VARIANT="dark" || GTK_THEME_VARIANT="light"',
        'export GTK_THEME="${APPIMAGE_GTK_THEME:-"Adwaita:$GTK_THEME_VARIANT"}"',
        "export GDK_BACKEND=x11 # https://github.com/tauri-apps/tauri/issues/8541",
        "",
      ].join("\n"),
    );
    console.log("→ neutralized the GTK apprun hook (theme sniff + GDK_BACKEND=x11 kept)");
  }

  // POSTCONDITIONS (the 1.5-E lesson): fail loud, never ship a half-strip.
  const survivors = readdirSync(libDir).filter((e) => e !== "Brainpick");
  if (survivors.length > 0) {
    console.error(`✗ postcondition failed — usr/lib entries survived the strip: ${survivors.join(", ")}`);
    process.exit(1);
  }
  if (existsSync(hook) && /usr\/(lib|share)/.test(readFileSync(hook, "utf8"))) {
    console.error("✗ postcondition failed — the GTK hook still points into the AppDir");
    process.exit(1);
  }

  let tool = process.argv[3] ?? process.env["APPIMAGETOOL"] ?? "";
  if (!tool) {
    // Cache OUTSIDE the bundle output dir: tauri's bundler wipes that dir on
    // every build, which forced a fresh download per repack (and one flaky
    // curl left an UNREPACKED, lib-poisoned AppImage behind — 2026-07-12).
    const cache = join(homedir(), ".cache", "brainpick");
    tool = join(cache, "appimagetool-x86_64.AppImage");
    if (!existsSync(tool)) {
      console.log("→ downloading appimagetool (continuous)");
      mkdirSync(cache, { recursive: true });
      sh("curl", ["-fsSL", "--retry", "3", "--retry-delay", "2", "-o", tool, APPIMAGETOOL_URL]);
      chmodSync(tool, 0o755);
    }
  }

  const repacked = `${appimage}.repacked`;
  console.log("→ repacking");
  // APPIMAGETOOL_RUNTIME: a local type2 runtime file skips appimagetool's own
  // network fetch — offline/flaky-network builds keep working (2026-07-12:
  // one dead GitHub CDN moment left an unrepacked AppImage on the machine).
  const runtime = process.env["APPIMAGETOOL_RUNTIME"];
  const args = runtime ? ["--runtime-file", runtime, extractDir, repacked] : [extractDir, repacked];
  sh(tool, args, {
    env: { ...process.env, ARCH: "x86_64", APPIMAGE_EXTRACT_AND_RUN: "1" },
  });
  renameSync(repacked, appimage);
  rmSync(extractDir, { recursive: true, force: true });
  console.log(`✓ repacked in place: ${appimage}`);
}

main();
