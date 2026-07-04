/**
 * GPU tier detection — a pure classifier that turns a handful of injected
 * browser signals into a render budget, so the cosmos stays smooth on weak /
 * mobile GPUs without any per-frame guesswork.
 *
 * `detectGpuTier(inputs)` is deterministic: it never touches the DOM or a real
 * WebGL context, so it is fully unit-testable. The impure `readGpuInputs()`
 * gathers the real signals in the browser (WEBGL_debug_renderer_info's
 * UNMASKED_RENDERER when the extension exists, plus navigator / window / a
 * throwaway canvas) and is only called from main.tsx.
 *
 * Why client-side: config has `[ui] max_nodes_mobile`, but no engine ships it
 * to the UI yet (see tuning.ts). The cap is derived here from the device.
 */
import { GPU_BUDGET } from './tuning';

export type GpuTierName = 'low' | 'mid' | 'high';

/** The device signals the classifier reads — inject these in tests. */
export interface GpuInputs {
  /** WEBGL_debug_renderer_info UNMASKED_RENDERER string, or null if masked. */
  renderer: string | null;
  /** navigator.userAgent. */
  userAgent: string;
  /** navigator.hardwareConcurrency (logical cores), or undefined. */
  hardwareConcurrency: number | undefined;
  /** navigator.deviceMemory (GB, Chromium-only), or undefined. */
  deviceMemory: number | undefined;
  /** window.devicePixelRatio. */
  devicePixelRatio: number;
  /** gl.getParameter(gl.MAX_TEXTURE_SIZE), or undefined when no GL context. */
  maxTextureSize: number | undefined;
}

/** The classifier's verdict: a tier plus the render budget it unlocks. */
export interface GpuTier {
  tier: GpuTierName;
  /** Node-count cap before culling + aggregation kick in. */
  nodeBudget: number;
  /** devicePixelRatio ceiling for the canvas. */
  dprCap: number;
  /** Whether the wide additive halo is drawn (off on the weakest GPUs). */
  bloomEnabled: boolean;
  /** Ceiling on how many HTML labels the scene will place. */
  labelBudget: number;
}

const MOBILE_RE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Silk/i;
const SOFTWARE_RE = /swiftshader|llvmpipe|software|basic render|microsoft basic/i;
const DISCRETE_RE = /nvidia|geforce|\brtx\b|\bgtx\b|radeon|\brx\s?\d|\bamd\b|apple\s+m\d|quadro|arc\s+a\d/i;
const INTEGRATED_RE = /intel|\buhd\b|iris|hd graphics|mali|adreno|powervr|vivante|videocore/i;

/** Build the full tier record from a tier name (pulls budgets from tuning). */
export function tierFor(tier: GpuTierName): GpuTier {
  return {
    tier,
    nodeBudget: GPU_BUDGET.nodeBudget[tier],
    dprCap: GPU_BUDGET.dprCap[tier],
    bloomEnabled: GPU_BUDGET.bloomEnabled[tier],
    labelBudget: GPU_BUDGET.labelBudget[tier],
  };
}

/**
 * Classify a device into a tier from injected signals — deterministic.
 *
 * Hard rules first (mobile and software rasterizers are always `low`), then a
 * small additive score over the remaining signals. Integrated GPUs are capped
 * at `mid`: they never earn the 40k `high` budget even with many cores.
 */
export function classifyTier(inputs: GpuInputs): GpuTierName {
  if (MOBILE_RE.test(inputs.userAgent)) return 'low';
  const r = inputs.renderer;
  if (r && SOFTWARE_RE.test(r)) return 'low';

  let score = 0;
  const discrete = r !== null && DISCRETE_RE.test(r);
  const integrated = r !== null && !discrete && INTEGRATED_RE.test(r);
  if (discrete) score += 3;
  else if (integrated) score += 1;

  const cores = inputs.hardwareConcurrency ?? 0;
  if (cores >= 12) score += 3;
  else if (cores >= 8) score += 2;
  else if (cores >= 4) score += 1;

  if (inputs.devicePixelRatio >= 2) score += 1;
  if ((inputs.deviceMemory ?? 0) >= 8) score += 1;

  const tex = inputs.maxTextureSize;
  if (tex !== undefined) {
    if (tex >= 16_384) score += 2;
    else if (tex >= 8_192) score += 1;
    else if (tex < 4_096) score -= 2;
  }

  let tier: GpuTierName = score >= 6 ? 'high' : score >= 3 ? 'mid' : 'low';
  // Integrated graphics stay off the top shelf however many cores they pack.
  if (integrated && tier === 'high') tier = 'mid';
  return tier;
}

/** Detect the device tier and the budget it unlocks (pure, testable). */
export function detectGpuTier(inputs: GpuInputs): GpuTier {
  return tierFor(classifyTier(inputs));
}

/**
 * Default before real detection runs (and the value tests/SSR see): the top
 * tier, so nothing is ever capped by accident — real detection only lowers it.
 */
export const DEFAULT_GPU_TIER: GpuTier = tierFor('high');

/**
 * Gather the real device signals in the browser. Impure and defensive: any
 * failure (no WebGL, blocked extension) degrades to heuristics on the other
 * signals rather than throwing. Not called in unit tests.
 */
export function readGpuInputs(): GpuInputs {
  interface NavLike {
    userAgent?: string;
    hardwareConcurrency?: number;
    deviceMemory?: number;
  }
  const nav: NavLike = typeof navigator !== 'undefined' ? (navigator as NavLike) : {};
  let renderer: string | null = null;
  let maxTextureSize: number | undefined;
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number | null;
      if (typeof max === 'number' && Number.isFinite(max)) maxTextureSize = max;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        const raw = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string | null;
        if (typeof raw === 'string' && raw.length > 0) renderer = raw;
      }
      // Release the context promptly — this canvas is throwaway.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    // No WebGL available — fall back to the non-GL heuristics.
  }
  return {
    renderer,
    userAgent: nav.userAgent ?? '',
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    maxTextureSize,
  };
}
