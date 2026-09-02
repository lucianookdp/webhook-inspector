import { useState } from 'react';
import { useCopy } from './useCopy';

type Language = 'curl' | 'javascript' | 'python';

const LANGUAGES: Language[] = ['curl', 'javascript', 'python'];

const LABELS: Record<Language, string> = {
  curl: 'curl',
  javascript: 'JavaScript',
  python: 'Python',
};

function buildSnippet(language: Language, url: string): string {
  switch (language) {
    case 'curl':
      return `curl -X POST ${url} \\\n  -H "Content-Type: application/json" \\\n  -d '{"hello":"world"}'`;
    case 'javascript':
      return `fetch("${url}", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({ hello: "world" }),\n});`;
    case 'python':
      return `import requests\n\nrequests.post(\n    "${url}",\n    json={"hello": "world"},\n)`;
  }
}

export function Snippets({ url }: { url: string }) {
  const [active, setActive] = useState<Language>('curl');
  const [copied, copy] = useCopy();
  const snippet = buildSnippet(active, url);

  return (
    <div className="snippets">
      <div className="snippets__tabs" role="tablist">
        {LANGUAGES.map((language) => (
          <button
            key={language}
            type="button"
            role="tab"
            aria-selected={active === language}
            className={active === language ? 'snippets__tab snippets__tab--active' : 'snippets__tab'}
            onClick={() => setActive(language)}
          >
            {LABELS[language]}
          </button>
        ))}
      </div>
      <div className="snippets__panel">
        <pre>{snippet}</pre>
        <button type="button" className="snippets__copy" onClick={() => copy(snippet)}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
