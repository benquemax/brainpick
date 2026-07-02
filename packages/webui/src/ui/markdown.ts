/**
 * Markdown rendering for the doc panel: marked + a small DOM sanitizer
 * (bundle docs are the user's own, but agents write into them too — strip
 * active content before innerHTML).
 */
import { marked } from 'marked';

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, gfm: true });
  return sanitizeHtml(html);
}

function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of doc.querySelectorAll('script, iframe, object, embed, style, link, meta, form')) {
    el.remove();
  }
  for (const el of doc.body.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src' || name === 'xlink:href') && value.startsWith('javascript:')) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return doc.body.innerHTML;
}
