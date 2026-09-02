import { Snippets } from './Snippets';

export function EmptyState({ url }: { url: string }) {
  return (
    <div className="empty-state">
      <ol className="empty-state__steps">
        <li>Copy the URL above, or use the button above to send one yourself.</li>
        <li>Send it any HTTP request — from your terminal, your code, or a service that fires webhooks.</li>
        <li>Watch it show up here, in real time.</li>
      </ol>
      <Snippets url={url} />
    </div>
  );
}
