import { useState, useEffect } from 'react';
const nav = [
  { label: 'Dashboard', href: '#/dashboard' },
  { label: 'Expenses', href: '#/expenses' },
  { label: 'Budgets', href: '#/budgets' },
  { label: 'Categories', href: '#/categories' },
  { label: 'Analytics', href: '#/analytics' },
  { label: 'Vault', href: '#/vault' },
  { label: 'Settings', href: '#/settings' },
];
export default function Sidebar() {
  const [avatar, setAvatar] = useState('elephant.png');
  const [name, setName] = useState('Alex');
  useEffect(() => { setAvatar(localStorage.getItem('avatar') || 'elephant.png'); }, []);
  return (
    <aside className="w-72 h-screen bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col">
      <div className="p-2 flex items-center gap-3">
        <img src="/assets/brand/xpensic-light.png" className="h-7 dark:hidden" alt="Xpensic" />
        <img src="/assets/brand/xpensic-dark.png" className="h-7 hidden dark:block" alt="Xpensic" />
      </div>
      <div className="px-6 py-4 flex items-center gap-3 border-b border-slate-200 dark:border-slate-800">
        <img src={`/logos/avatars/${avatar}`} alt="avatar" className="w-10 h-10 rounded-full bg-white dark:bg-slate-800 shadow" />
        <div><div className="font-semibold text-slate-900 dark:text-white">{name}</div><div className="text-xs text-slate-500">Pro Plan</div></div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map(n => (
          <a key={n.label} href={n.href} className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-emerald-600 dark:hover:text-emerald-400 transition">{n.label}</a>
        ))}
      </nav>
      <div className="p-4 border-t border-slate-200 dark:border-slate-800">
        <div className="text-xs font-semibold text-slate-200 uppercase tracking-wider mb-2">Quick Actions</div>
        <div className="flex gap-2">
          <button className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition">Add</button>
          <button onClick={() => alert('Coming Soon')} aria-label="Scan receipt" className="flex flex-col items-center justify-center gap-1 flex-1 py-2 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium hover:bg-slate-300 dark:hover:bg-slate-700 transition">
            <span className="flex items-center justify-center w-4 h-4 text-slate-600 dark:text-slate-300">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            </span>
            <span>Scan Receipt</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
