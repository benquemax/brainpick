/**
 * Markdown-flavoured input rules: type `## `, `> `, `- `, `1. ` or ```` ``` ````
 * and the block becomes what you meant — the WYSIWYG feel without ever showing
 * the syntax. Structural only (no smart-quote / em-dash substitution) so the
 * serialized markdown stays byte-predictable.
 */
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import type { Plugin } from 'prosemirror-state';
import { schema } from './schema';

const { blockquote, ordered_list, bullet_list, code_block, heading } = schema.nodes;

const blockquoteRule = wrappingInputRule(/^\s*>\s$/, blockquote);

const orderedListRule = wrappingInputRule(
  /^(\d+)\.\s$/,
  ordered_list,
  (match) => ({ order: +match[1]! }),
  (match, node) => node.childCount + (node.attrs.order as number) === +match[1]!,
);

const bulletListRule = wrappingInputRule(/^\s*([-+*])\s$/, bullet_list);

const codeBlockRule = textblockTypeInputRule(/^```$/, code_block);

const headingRule = textblockTypeInputRule(/^(#{1,6})\s$/, heading, (match) => ({ level: match[1]!.length }));

export function markdownInputRules(): Plugin {
  return inputRules({
    rules: [blockquoteRule, orderedListRule, bulletListRule, codeBlockRule, headingRule] as InputRule[],
  });
}
