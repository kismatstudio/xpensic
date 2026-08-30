import { useState, useEffect } from 'react';
const avatars = [
  { file: 'elephant.png', name: 'Elephant' },
  { file: 'owl.png', name: 'Owl' },
  { file: 'fox.png', name: 'Fox' },
  { file: 'squirrel.png', name: 'Squirrel' },
  { file: 'ant.png', name: 'Ant' },
  { file: 'eagle.png', name: 'Eagle' },
  { file: 'turtle.png', name: 'Turtle' },
  { file: 'bee.png', name: 'Bee' },
  { file: 'bear.png', name: 'Bear' },
  { file: 'wolf.png', name: 'Wolf' },
  { file: 'rhino.png', name: 'Rhino' },
  { file: 'leopard.png', name: 'Leopard' },
];
export default function AvatarPicker() {
  const [selected, setSelected] = useState(() => localStorage.getItem('avatar') || 'elephant.png');
  useEffect(() => { localStorage.setItem('avatar', selected); }, [selected]);
  return (
    <div className="max-w-4xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-6 text-slate-900 dark:text-white">Financial Personality</h2>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
        {avatars.map(a => (
          <button key={a.file} onClick={() => setSelected(a.file)}
            className={`flex flex-col items-center p-3 rounded-2xl border-2 transition shadow-sm hover:shadow-md ${selected === a.file ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'}`}>
            <img src={`/logos/avatars/${a.file}`} alt={a.name} className="w-16 h-16 object-contain mb-2" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{a.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
