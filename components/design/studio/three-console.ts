import * as THREE from "three";

/**
 * Keeps one kind of noise out of the console: the Direct3D shader compiler's
 * precision notes.
 *
 * On Windows, Chrome runs WebGL through ANGLE, which hands every shader to
 * D3D's HLSL compiler. That compiler annotates three's own built-in shader
 * chunks with lines like
 *
 *   (210,81-129): warning X4122: sum of 0.996094 and -2.98e-17 cannot be
 *   represented accurately in double precision
 *
 * and three prints any non-empty program log as a warning. The shader links
 * and renders correctly; the note is about constant folding inside three's
 * packing code, not anything this app wrote, and it fires on every page with
 * a scene.
 *
 * Only a log made up ENTIRELY of those D3D `warning X####` lines is dropped.
 * A real link error is reported through a different path (runnable = false)
 * and never reaches here as a warning, and a log with anything else in it is
 * passed through whole, so this cannot hide a problem three meant to show.
 */

const D3D_COMPILER_NOTE = /^\(\d+,\d+(?:-\d+)?\): warning X\d+:/;

function isOnlyCompilerNotes(log: unknown): boolean {
  if (typeof log !== "string") return false;
  const lines = log
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((line) => D3D_COMPILER_NOTE.test(line));
}

type StackTraceParam = { isStackTrace: true; getError(message: string): Error };

function isStackTrace(value: unknown): value is StackTraceParam {
  return typeof value === "object" && value !== null && (value as StackTraceParam).isStackTrace === true;
}

let installed = false;

/** Idempotent; call before creating a WebGLRenderer. */
export function installThreeConsoleFilter() {
  if (installed) return;
  installed = true;

  THREE.setConsoleFunction((type: "log" | "warn" | "error", message: string, ...params: unknown[]) => {
    if (
      type === "warn" &&
      message === "THREE.WebGLProgram: Program Info Log:" &&
      isOnlyCompilerNotes(params[0])
    ) {
      return;
    }
    // Everything else goes out exactly as three would have sent it.
    if (isStackTrace(params[0])) {
      console[type](params[0].getError(message));
    } else {
      console[type](message, ...params);
    }
  });
}
