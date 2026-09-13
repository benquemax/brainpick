/**
 * Conventions (spec/85 *Conventions*, spec/20 *t1/conventions.json*): the
 * `type: convention` docs — standing rules — compiled into an artifact so the
 * overview and the AGENTS.md report can list them before anything else. The
 * engine indexes and never edits. Twin of
 * packages/python/src/brainpick/compile/conventions.py.
 */
import { isConvention, type Document } from "../core/bundle";
import { cmpStr } from "../core/canonical";

export { isConvention };

export interface ConventionRecord {
  description: string | null;
  path: string;
  title: string;
}

export interface ConventionsArtifact {
  conventions: ConventionRecord[];
}

/** The t1/conventions.json payload: every convention, sorted by path. */
export function buildConventions(docs: readonly Document[]): ConventionsArtifact {
  return {
    conventions: [...docs]
      .sort((a, b) => cmpStr(a.path, b.path))
      .filter((doc) => doc.convention)
      .map((doc) => ({ description: doc.description, path: doc.path, title: doc.title })),
  };
}
