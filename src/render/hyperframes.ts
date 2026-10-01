import { exec } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(exec);

/**
 * Render a HyperFrames composition project to an mp4.
 *
 * The seam that lets the Remotion path be retired. `remotionRenderer.ts` states the contract this
 * follows — *"a pure function `(beat, resolvedProps) -> filePath` … so moving to Lambda later is
 * a deployment change, not a rewrite"* — and the same holds here: a project directory in, a file
 * path out, with the renderer's own gate run first.
 *
 * ## Why `check` runs before `render`, always
 *
 * `hyperframes check` boots Chrome once and audits runtime errors, layout, WCAG contrast and
 * motion assertions over a seek grid. Rendering without it produces an mp4 of whatever was wrong.
 *
 * There is a trap in reading its result, and it is the reason `--json` is parsed rather than the
 * exit code alone: **a lint error switches the layout and contrast audits off entirely**, and the
 * report then says `0 sample(s)` and `0/0 text checks`, which reads like a clean file and means
 * nothing ran. A zero sample count is treated here as a failure.
 *
 * ## What this deliberately does not do
 *
 * It does not author anything. A HyperFrames project reaches this function already written —
 * by an agent following the `direct-beat` skill, against a `BeatBrief`. That division is the
 * whole point of Phase X: the machinery renders and verifies, the composing is not machinery.
 */

export interface HyperframesRenderOptions {
  /** Project directory containing `index.html` and `hyperframes.json`. */
  projectDir: string;
  /** Where the mp4 goes. Parent directories are created. */
  outputPath: string;
  /** `draft` | `looks` | `delivery`. `looks` is the renderer's own default and ours. */
  quality?: "draft" | "looks" | "delivery";
  /** Seek samples for the pre-render gate. More samples catch more mid-transition defects. */
  samples?: number;
  /** Skip the gate. Only for re-rendering something already checked in the same run. */
  skipCheck?: boolean;
  /** Milliseconds. A 17s square reel renders in ~15s on a warm machine; a cold browser adds more. */
  timeoutMs?: number;
  /**
   * How frames are pulled out of source videos. `png` for screen recordings: JPEG extraction smears
   * saturated UI colours and the thin text of a recorded interface, which is the whole point of the footage.
   */
  videoFrameFormat?: "png" | "jpg" | "auto";
}

export interface HyperframesRenderResult {
  status: "rendered" | "failed";
  outputPath?: string;
  error?: string;
  /** Samples the gate actually audited. Zero means the audit did not run — see above. */
  checkSamples?: number;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Quote an argument for a shell command line.
 *
 * The CLI has to go through a shell rather than be spawned directly: `npx` on Windows is
 * `npx.cmd`, and since Node 18.20 spawning a `.cmd` without a shell fails outright with
 * `spawn EINVAL`. The first version of this connector used `execFile("npx.cmd", [...])` and did
 * exactly that — it typechecked, its tests passed, and it could not run, because no test
 * spawned anything.
 *
 * A shell means quoting is ours to do, and the output path is the argument that matters: a
 * render target under a temp directory is fine, one under a path with a space in it is not, and
 * an unquoted space there silently truncates the path.
 */
export function quoteArg(arg: string): string {
  return /[\s"'`$&|<>()^;]/.test(arg) ? `"${arg.replace(/(["\\])/g, "\\$1")}"` : arg;
}

function cliLine(args: readonly string[]): string {
  return ["npx", "hyperframes", ...args].map(quoteArg).join(" ");
}

export interface CheckReport {
  /** The report's own top-level verdict. Authoritative. */
  ok?: boolean;
  /** How many seek positions the LAYOUT audit actually visited. Zero means it did not run. */
  layoutSamples?: number;
  /** Text nodes the contrast audit examined. */
  contrastChecked?: number;
  errors?: number;
  /** The error findings themselves, one line each: what failed, where, and when. */
  failures?: string[];
}

/**
 * Read `check --json`.
 *
 * Written against the shape the CLI actually emits at 0.8.x, which was established by running it
 * rather than by reading about it — and which has two traps a generic walk falls straight into:
 *
 *   layout.samples    an ARRAY of visited positions   (length 20 for `--samples 20`)
 *   motion.samples    a NUMBER, and 0 whenever there are no *.motion.json assertions
 *
 * The first version of this parser searched the whole tree for a field named `samples` or
 * `sampleCount` and kept the last one it found. That is `motion.samples`, which is legitimately
 * zero on every composition without motion assertions — so a perfectly clean 34-sample check was
 * reported as "audited 0 samples" and the render was refused. Read the named fields.
 *
 * Still tolerant about the parts it does not recognise: the CLI is pre-1.0 and this shape is not
 * a contract we control, so a field that moves comes back `undefined` — "could not tell" — which
 * the caller treats differently from a real zero.
 */
export function parseCheckReport(stdout: string): CheckReport {
  const start = stdout.indexOf("{");
  if (start < 0) return {};
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout.slice(start)) as Record<string, unknown>;
  } catch {
    return {};
  }

  const section = (name: string): Record<string, unknown> | undefined => {
    const value = parsed[name];
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  };

  const out: CheckReport = {};
  if (typeof parsed.ok === "boolean") out.ok = parsed.ok;

  const layout = section("layout");
  if (layout) {
    if (Array.isArray(layout.samples)) out.layoutSamples = layout.samples.length;
    else if (typeof layout.samples === "number") out.layoutSamples = layout.samples;
  }

  const contrast = section("contrast");
  if (contrast && typeof contrast.checked === "number") out.contrastChecked = contrast.checked;

  let errors: number | undefined;
  for (const name of ["lint", "runtime", "layout", "motion", "contrast"]) {
    const count = section(name)?.errorCount;
    if (typeof count === "number") errors = (errors ?? 0) + count;
  }
  if (errors !== undefined) out.errors = errors;

  // Group repeats of one finding on one element: a contrast failure seen at 24 sample times is one
  // problem, and the agent needs its selector and message, not 24 lines of it.
  const failures = new Map<string, { line: string; times: number[] }>();
  for (const name of ["lint", "runtime", "layout", "motion", "contrast"]) {
    const findings = section(name)?.findings;
    if (!Array.isArray(findings)) continue;
    for (const f of findings as Record<string, unknown>[]) {
      if (f.severity !== "error") continue;
      const key = `${name}:${String(f.code)}:${String(f.selector ?? "")}`;
      const entry = failures.get(key) ?? { line: `${name} ${String(f.code)} ${String(f.selector ?? "")} — ${String(f.message ?? "").slice(0, 160)}`, times: [] };
      if (typeof f.time === "number") entry.times.push(f.time);
      failures.set(key, entry);
    }
  }
  if (failures.size > 0) {
    out.failures = [...failures.values()].map(({ line, times }) => (times.length ? `${line} (at ${times.map((t) => t.toFixed(1)).join(", ")}s)` : line));
  }

  return out;
}

export async function renderHyperframesProject(options: HyperframesRenderOptions): Promise<HyperframesRenderResult> {
  const { projectDir, outputPath, quality = "looks", samples = 24, skipCheck = false, timeoutMs = DEFAULT_TIMEOUT_MS, videoFrameFormat } = options;
  try {
    await access(path.join(projectDir, "index.html"));
  } catch {
    return { status: "failed", error: `no index.html in ${projectDir}` };
  }

  if (!skipCheck) {
    try {
      const { stdout } = await run(cliLine(["check", "--samples", String(samples), "--json"]), {
        cwd: projectDir,
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      });
      const report = parseCheckReport(stdout);
      if (report.ok === false || (report.errors ?? 0) > 0) {
        return { status: "failed", error: checkFailure(report), ...(report.layoutSamples === undefined ? {} : { checkSamples: report.layoutSamples }) };
      }
      if (report.layoutSamples === 0) {
        return { status: "failed", error: "check audited 0 layout samples — a lint error switches the layout and contrast audits off, so this is not a pass", checkSamples: 0 };
      }
      return await renderOnly({ projectDir, outputPath, quality, timeoutMs, checkSamples: report.layoutSamples, ...(videoFrameFormat ? { videoFrameFormat } : {}) });
    } catch (error) {
      // A non-zero exit from `check` is a real gate failure: findings, or a lint error. Its JSON is
      // still on stdout, and that — not stderr's font-fetch log — says what to fix.
      const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout ?? "") : "";
      const report = parseCheckReport(stdout);
      if (report.failures?.length) return { status: "failed", error: checkFailure(report) };
      return { status: "failed", error: `check failed: ${messageOf(error)}` };
    }
  }

  return await renderOnly({ projectDir, outputPath, quality, timeoutMs, ...(videoFrameFormat ? { videoFrameFormat } : {}) });
}

async function renderOnly(args: {
  projectDir: string;
  outputPath: string;
  quality: string;
  timeoutMs: number;
  checkSamples?: number;
  videoFrameFormat?: "png" | "jpg" | "auto";
}): Promise<HyperframesRenderResult> {
  const { projectDir, outputPath, quality, timeoutMs, checkSamples, videoFrameFormat } = args;
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });

  try {
    await run(cliLine(["render", "--quality", quality, ...(videoFrameFormat ? ["--video-frame-format", videoFrameFormat] : []), "--output", path.resolve(outputPath)]), {
      cwd: projectDir,
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    return { status: "failed", error: `render failed: ${messageOf(error)}`, ...(checkSamples === undefined ? {} : { checkSamples }) };
  }

  try {
    await access(path.resolve(outputPath));
  } catch {
    return { status: "failed", error: "render reported success but wrote no file", ...(checkSamples === undefined ? {} : { checkSamples }) };
  }

  return { status: "rendered", outputPath: path.resolve(outputPath), ...(checkSamples === undefined ? {} : { checkSamples }) };
}

function checkFailure(report: CheckReport): string {
  const head = `check reported ${report.errors ?? "some"} error(s)`;
  return report.failures?.length ? `${head}:\n    ${report.failures.join("\n    ")}` : head;
}

function messageOf(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
    if (stderr) return stderr.split(/\r?\n/).slice(-6).join(" | ");
  }
  return error instanceof Error ? error.message : String(error);
}
