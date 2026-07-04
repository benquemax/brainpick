/**
 * Status HUD: doc/edge/orphan counts, manifest seq, tier chips and the
 * connection state dot; a compile chip appears while a tier recompiles.
 */
import { useEffect, useMemo, useState } from 'react';
import { uiStore, useUI } from '../state/store';
import { budgetedGraph } from '../state/budget';
import type { TierName } from '../graph/types';

const TIER_ORDER: TierName[] = ['t1', 't2', 't3'];

export function StatusHUD() {
  const stats = useUI((s) => s.stats);
  const seq = useUI((s) => s.seq);
  const tiers = useUI((s) => s.tiers);
  const connection = useUI((s) => s.connection);
  const compile = useUI((s) => s.compile);

  // The GPU budget line appears ONLY when the view is actually capped — the
  // memoized budgeted view is the exact one the scene renders (honest N of M).
  const nodes = useUI((s) => s.nodes);
  const edges = useUI((s) => s.edges);
  const nodeBudget = useUI((s) => s.nodeBudget);
  const expandedDirs = useUI((s) => s.expandedDirs);
  const budget = useMemo(
    () => budgetedGraph(nodes, edges, seq, nodeBudget, expandedDirs),
    [nodes, edges, seq, nodeBudget, expandedDirs],
  );
  const capped = budget.aggregated.size > 0;

  // Show the last compile status briefly after it stops running.
  const [compileVisible, setCompileVisible] = useState(false);
  useEffect(() => {
    if (compile === null) return;
    setCompileVisible(true);
    if (compile.state === 'running') return;
    const t = setTimeout(() => setCompileVisible(false), 1_600);
    return () => clearTimeout(t);
  }, [compile]);

  return (
    <div className="hud panel">
      <div className="hud-row">
        <span className={`conn-dot ${connection}`} title={`connection: ${connection}`} />
        <span className="hud-title">brainpick</span>
        <span className="hud-seq" title="manifest seq">
          seq {seq}
        </span>
      </div>
      <div className="hud-row hud-stats">
        <span title="documents">{stats?.docs ?? '–'} docs</span>
        <span title="edges">{stats?.edges ?? '–'} edges</span>
        <span title="orphans">{stats?.orphans ?? '–'} orphans</span>
      </div>
      <div className="hud-row hud-tiers">
        {TIER_ORDER.map((tier) => {
          const state = tiers?.[tier] ?? 'off';
          return (
            <span key={tier} className={`tier-chip tier-${state === 'fresh' ? 'fresh' : state === 'off' ? 'off' : 'other'}`}>
              {tier} {state}
            </span>
          );
        })}
        {compileVisible && compile !== null && (
          <span className={`tier-chip compile ${compile.state === 'running' ? 'running' : ''}`}>
            {compile.state === 'running' ? `compiling ${compile.tier}…` : `${compile.tier} ${compile.state}`}
          </span>
        )}
      </div>
      {capped && (
        <div className="hud-row hud-budget">
          <span
            className="hud-budget-label"
            title="GPU performance budget — culled docs are grouped into cluster proxies you can click to expand"
          >
            showing {budget.shownNodes} of {budget.totalNodes} nodes
          </span>
          <button
            type="button"
            className="hud-more"
            title="raise the render budget (show more nodes)"
            onClick={() => uiStore.getState().raiseBudget()}
          >
            show more
          </button>
        </div>
      )}
    </div>
  );
}
