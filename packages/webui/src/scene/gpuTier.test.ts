import { describe, expect, it } from 'vitest';
import { classifyTier, detectGpuTier, tierFor, type GpuInputs } from './gpuTier';
import { GPU_BUDGET } from './tuning';

/** A strong desktop baseline; individual tests override the fields they probe. */
function inputs(over: Partial<GpuInputs> = {}): GpuInputs {
  return {
    renderer: null,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    hardwareConcurrency: 8,
    deviceMemory: 16,
    devicePixelRatio: 2,
    maxTextureSize: 16_384,
    ...over,
  };
}

describe('classifyTier', () => {
  it('forces low on any mobile user agent, however strong the other signals', () => {
    const t = classifyTier(
      inputs({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148',
        renderer: 'Apple GPU',
        hardwareConcurrency: 6,
        devicePixelRatio: 3,
      }),
    );
    expect(t).toBe('low');
  });

  it('forces low on a software rasterizer (SwiftShader / llvmpipe)', () => {
    expect(classifyTier(inputs({ renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))' }))).toBe('low');
    expect(classifyTier(inputs({ renderer: 'llvmpipe (LLVM 15.0.0, 256 bits)' }))).toBe('low');
  });

  it('lands a discrete-GPU high-DPR high-core desktop on high', () => {
    const t = classifyTier(
      inputs({
        renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0)',
        hardwareConcurrency: 16,
        devicePixelRatio: 2,
      }),
    );
    expect(t).toBe('high');
  });

  it('caps integrated graphics at mid even with many cores and a retina panel', () => {
    const t = classifyTier(
      inputs({
        renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)',
        hardwareConcurrency: 8,
        devicePixelRatio: 2,
        maxTextureSize: 16_384,
      }),
    );
    expect(t).toBe('mid');
  });

  it('falls back to heuristics when debug_renderer_info is unavailable (renderer null)', () => {
    // Strong headless / privacy-masked but capable → high on cores+dpr+mem+tex.
    expect(
      classifyTier(inputs({ renderer: null, hardwareConcurrency: 16, devicePixelRatio: 2, maxTextureSize: 16_384 })),
    ).toBe('high');
    // A modest laptop with the renderer masked → mid.
    expect(
      classifyTier(
        inputs({ renderer: null, hardwareConcurrency: 4, devicePixelRatio: 1, deviceMemory: 8, maxTextureSize: 8_192 }),
      ),
    ).toBe('mid');
    // A weak, masked device → low.
    expect(
      classifyTier(
        inputs({
          renderer: null,
          hardwareConcurrency: 2,
          devicePixelRatio: 1,
          deviceMemory: undefined,
          maxTextureSize: 4_096,
        }),
      ),
    ).toBe('low');
  });

  it('penalizes a tiny max texture size (an ancient / constrained GL)', () => {
    expect(
      classifyTier(inputs({ renderer: null, hardwareConcurrency: 8, devicePixelRatio: 1, maxTextureSize: 2_048 })),
    ).toBe('low');
  });
});

describe('detectGpuTier (tier -> budget)', () => {
  it('maps each tier to its tuning.ts budget, flags and caps', () => {
    for (const tier of ['low', 'mid', 'high'] as const) {
      const t = tierFor(tier);
      expect(t.nodeBudget).toBe(GPU_BUDGET.nodeBudget[tier]);
      expect(t.dprCap).toBe(GPU_BUDGET.dprCap[tier]);
      expect(t.bloomEnabled).toBe(GPU_BUDGET.bloomEnabled[tier]);
      expect(t.labelBudget).toBe(GPU_BUDGET.labelBudget[tier]);
    }
  });

  it('low tier is the frugal one: smallest budget, dpr 1, bloom off', () => {
    const low = detectGpuTier(inputs({ userAgent: 'iPhone Mobile' }));
    expect(low.tier).toBe('low');
    expect(low.nodeBudget).toBe(2_500);
    expect(low.dprCap).toBe(1);
    expect(low.bloomEnabled).toBe(false);
  });

  it('high tier unlocks the widest budget and full bloom', () => {
    const high = detectGpuTier(
      inputs({ renderer: 'NVIDIA GeForce RTX 4090', hardwareConcurrency: 24, devicePixelRatio: 2 }),
    );
    expect(high.tier).toBe('high');
    expect(high.nodeBudget).toBe(40_000);
    expect(high.bloomEnabled).toBe(true);
  });
});
