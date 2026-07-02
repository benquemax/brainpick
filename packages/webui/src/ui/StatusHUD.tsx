/**
 * Status HUD: doc/edge/orphan counts, manifest seq, tier chips and the
 * connection state dot; a compile chip appears while a tier recompiles.
 */
import { useEffect, useState } from 'react';
import { useUI } from '../state/store';
import type { TierName } from '../graph/types';

const TIER_ORDER: TierName[] = ['t1', 't2', 't3'];

export function StatusHUD() {
  const stats = useUI((s) => s.stats);
  const seq = useUI((s) => s.seq);
  const tiers = useUI((s) => s.tiers);
  const connection = useUI((s) => s.connection);
  const compile = useUI((s) => s.compile);

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
    </div>
  );
}
