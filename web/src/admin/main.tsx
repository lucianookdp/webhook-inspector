import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import AdminApp from './AdminApp';

// biome-ignore lint/style/noNonNullAssertion: admin.html defines #root unconditionally
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);
