import type { LibraryAsset, MediaType } from "./schema.js";

/**
 * The assets waiting for Claude to look at them.
 *
 * The deterministic pass can say what a file is and what colour it is; it cannot say that an image
 * is the real Claude mark, or a screenshot of a pricing page, or a stray photo. Those wait here
 * until a person runs `/reelcut tag-assets` and Claude views each preview and writes tags and a
 * description. Claude's tags land as `claude`-origin and the asset stays pending: Claude suggests,
 * a person approves.
 *
 * Sounds are not queued — Claude cannot listen to them — and nothing from a private folder is, so
 * what is in it is never shown to Claude.
 */

const LOOKABLE: ReadonlySet<MediaType> = new Set(["image", "vector", "video"]);

export function needsClaude(asset: LibraryAsset): boolean {
  if (asset.private || asset.review.state !== "pending" || asset.status !== "active") return false;
  if (!LOOKABLE.has(asset.mediaType)) return false;
  if (asset.analysis.description) return false;
  return !Object.values(asset.tagOrigin).includes("claude");
}

export function claudeQueue(assets: readonly LibraryAsset[]): LibraryAsset[] {
  return assets.filter(needsClaude).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}
