// Lightweight page extractors injected into the page context.
// Defines window.parserReadability() and window.turn2Markdown(selector?) if not already present.
(function () {
  try {
    if (typeof window !== 'undefined') {
      if (typeof window.parserReadability !== 'function') {
        window.parserReadability = function () {
          try {
            const pick = (sel) => document.querySelector(sel);
            const main = pick('article, main, [role="main"], .article, .post, .content') || document.body;
            const title = (document.querySelector('h1') || document.title || '').textContent || document.title || '';
            const nodeToText = (node) => (node && typeof node.innerText === 'string' ? node.innerText : (node && node.textContent) || '');
            const contentText = nodeToText(main).trim();
            const excerpt = contentText.split('\n').find(l => l.trim().length > 0) || '';
            return {
              title: title.trim(),
              content: main.outerHTML || '',
              textContent: contentText,
              length: contentText.length,
              excerpt: excerpt.slice(0, 200),
              byline: '',
              dir: document.dir || 'ltr',
              siteName: (document.querySelector('meta[property="og:site_name"]') || {}).content || location.hostname,
              lang: document.documentElement.lang || '',
              publishedTime: (document.querySelector('meta[property="article:published_time"]') || {}).content || ''
            };
          } catch (e) {
            return null;
          }
        };
      }

      if (typeof window.turn2Markdown !== 'function') {
        window.turn2Markdown = function (selector) {
          try {
            const root = selector ? document.querySelector(selector) : (document.querySelector('article, main, [role="main"], .article, .post, .content') || document.body);
            if (!root) return '';
            const clone = root.cloneNode(true);
            
            // Remove noise elements - but be conservative to avoid removing content
            clone.querySelectorAll('script, style, nav, footer, noscript, iframe').forEach(n => n.remove());
            
            // Simple converters
            const escape = (s) => s.replace(/\*/g, '\\*').replace(/_/g, '\\_').replace(/`/g, '\\`');
            const lines = [];
            
            const walk = (node) => {
              if (node.nodeType === Node.TEXT_NODE) {
                const t = node.nodeValue.replace(/\s+/g, ' ').trim();
                if (t) lines.push(t);
                return;
              }
              if (!(node instanceof Element)) return;
              
              const tag = node.tagName.toLowerCase();
              
              // Headings - extract text and stop
              if (/^h[1-6]$/.test(tag)) {
                const level = Number(tag.charAt(1));
                const text = node.textContent.replace(/\s+/g, ' ').trim();
                if (text) lines.push('\n' + '#'.repeat(level) + ' ' + escape(text) + '\n');
                return;
              }
              
              // Paragraphs - add spacing
              if (tag === 'p') {
                const text = node.textContent.replace(/\s+/g, ' ').trim();
                if (text) lines.push('\n' + escape(text) + '\n');
                return;
              }
              
              // List items
              if (tag === 'li') {
                const text = node.textContent.replace(/\s+/g, ' ').trim();
                if (text) lines.push('\n- ' + escape(text));
                return;
              }
              
              // Links
              if (tag === 'a') {
                const href = node.getAttribute('href') || '';
                const text = node.textContent.replace(/\s+/g, ' ').trim();
                if (text && href && !href.startsWith('javascript:')) {
                  lines.push('[' + escape(text) + '](' + href + ')');
                } else if (text) {
                  lines.push(escape(text));
                }
                return;
              }
              
              // Images
              if (tag === 'img') {
                const alt = node.getAttribute('alt') || '';
                const src = node.getAttribute('src') || '';
                if (src) lines.push('\n![' + escape(alt) + '](' + src + ')\n');
                return;
              }
              
              // Line breaks
              if (tag === 'br') {
                lines.push(' ');
                return;
              }
              
              // For all other elements (div, section, span, etc.), recurse into children
              Array.from(node.childNodes).forEach(child => walk(child));
            };
            
            Array.from(clone.childNodes).forEach(node => walk(node));
            
            // Join and clean up
            return lines.join(' ')
              .replace(/ +/g, ' ')            // Collapse multiple spaces
              .replace(/\n +/g, '\n')          // Remove spaces after newlines
              .replace(/ +\n/g, '\n')          // Remove spaces before newlines
              .replace(/\n{3,}/g, '\n\n')      // Max 2 consecutive newlines
              .trim();
          } catch (e) {
            return '';
          }
        };
      }
    }
  } catch {}
})();


