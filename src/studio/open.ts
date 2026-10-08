import { spawn } from "node:child_process";

/** Opens a page in the default browser, without waiting for it. */
export function openBrowser(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
}
