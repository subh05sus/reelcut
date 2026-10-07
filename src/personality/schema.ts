import { z } from "zod";
import { STYLE_IDS } from "./styles.js";

/**
 * A personality: everything that makes every reel recognisably the owner's. Saved in ~/.reelcut/personalities.json;
 * one of them is the default and Step 0 confirms it in one line. Each wizard step owns one section.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const styleId = z.enum(STYLE_IDS as unknown as [string, ...string[]]);
const level = z.number().min(0).max(1);

export const PaletteSchema = z.object({ id: z.string(), name: z.string(), ground: hex, ink: hex, accent: hex, accent2: hex });

export const BEAT_KINDS = ["hook", "statement", "data", "product", "quote", "cta"] as const;

export const PersonalitySchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(60),
  isDefault: z.boolean().default(false),
  /** Up to three styles, each with its share of the reel (the mixer). */
  styles: z.array(z.object({ id: styleId, weight: z.number().min(0).max(100) })).max(3).default([]),
  /** Which style a beat of each kind is composed in (the mixer). */
  beatStyles: z.record(z.enum(BEAT_KINDS), styleId).default({}),
  /** A colour scheme per chosen style: a curated one, the brand's adapted, or custom. */
  palettes: z.record(styleId, PaletteSchema).default({}),
  /** A type pairing id per chosen style. */
  fonts: z.record(styleId, z.string()).default({}),
  motion: z.object({
    energy: z.enum(["restrained", "default", "energetic"]).default("default"),
    camera: z.enum(["still", "slow-push", "drift", "handheld"]).default("slow-push"),
    overshoot: z.enum(["never", "earned", "playful"]).default("earned"),
    transitions: z.enum(["hard-cut", "match-cut", "whip"]).default("hard-cut"),
    cadence: z.enum(["style", "smooth", "stepped"]).default("style"),
  }).default({}),
  texture: z.object({ grain: level, paper: level, halftone: level, leaks: level, vignette: level, glow: level, chroma: level, scanlines: level, useStyle: z.boolean() })
    .partial().default({ useStyle: true }),
  signature: z.object({
    intro: z.enum(["none", "logo-sting", "word-slam", "iris", "title-card"]).default("none"),
    logoReveal: z.enum(["draw", "assemble", "flood", "fade", "none"]).default("draw"),
    lowerThird: z.enum(["pill", "bar", "glass", "plain", "none"]).default("pill"),
    endCard: z.enum(["mark-url", "big-cta", "quote", "none"]).default("mark-url"),
    emphasis: z.enum(["serif-italic", "highlighter", "box", "underline", "colour", "circle"]).default("serif-italic"),
    captions: z.enum(["none", "key-words", "karaoke", "full"]).default("key-words"),
    tagline: z.string().max(80).default(""),
  }).default({}),
  copy: z.object({
    case: z.enum(["sentence", "title", "upper", "lower"]).default("sentence"),
    punctuation: z.enum(["full-stops", "none", "as-written"]).default("as-written"),
    emoji: z.boolean().default(false),
    quotes: z.enum(["german", "english", "guillemets"]).default("german"),
    numbers: z.enum(["digits", "words"]).default("digits"),
    voice: z.enum(["calm", "confident", "playful", "provocative"]).default("confident"),
  }).default({}),
  sound: z.object({
    effects: z.enum(["off", "soft-ui", "paper", "retro", "cinematic", "punchy", "style"]).default("style"),
    music: z.enum(["none", "ambient", "lofi", "upbeat", "cinematic", "electronic"]).default("upbeat"),
    bpm: z.tuple([z.number().min(40).max(200), z.number().min(40).max(200)]).default([90, 125]),
    effectsLevel: z.enum(["subtle", "present", "loud"]).default("present"),
  }).default({}),
  pacing: z.object({
    text: z.enum(["full", "key-lines", "minimal", "none", "auto"]).default("auto"),
    beatSeconds: z.tuple([z.number().min(1).max(12), z.number().min(1).max(12)]).default([2.5, 5]),
    payoffHold: z.number().min(0.8).max(4).default(1.6),
    format: z.enum(["1:1", "9:16", "16:9", "4:5"]).default("9:16"),
  }).default({}),
  guardrails: z.object({
    bannedColors: z.array(hex).default([]),
    bannedFonts: z.array(z.string()).default([]),
    bannedMoves: z.array(z.string()).default([]),
    maxFonts: z.number().int().min(1).max(4).default(3),
    contrast: z.number().min(4.5).max(7).default(4.5),
    noGlass: z.boolean().default(false),
    noConfetti: z.boolean().default(false),
    notes: z.string().max(500).default(""),
  }).default({}),
  brand: z.object({
    name: z.string().max(60).default(""),
    url: z.string().max(300).default(""),
    colors: z.array(hex).max(8).default([]),
    fonts: z.array(z.string()).max(6).default([]),
    logo: z.string().max(500).default(""),
  }).default({}),
  /** Wizard steps the owner has confirmed. */
  done: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Personality = z.infer<typeof PersonalitySchema>;
export type PersonalityInput = z.input<typeof PersonalitySchema>;
