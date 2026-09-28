/**
 * The shared vocabulary: what a beat is, how long a line takes to read, and the frame sizes.
 *
 * Ported from `@visual-studio/core`'s browser-safe barrel, minus everything that only existed for
 * the Remotion pipeline (render-job shapes, output-naming conventions, the asset-library schemas)
 * and minus `geminiThinking`, which has no purpose in a skill where the agent is the director.
 *
 * No Node built-ins, one npm dependency (`zod`).
 */
export * from "./readingFloor.js";
export * from "./constants.js";
export * from "./schemas/visualType.js";
export * from "./schemas/textMode.js";
export * from "./schemas/visualMix.js";
export * from "./schemas/beat.js";
