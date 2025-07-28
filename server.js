import { useEffect, useState } from 'react';
import { useWebAppInitDataUnsafe } from '@kloktunov/react-telegram-webapp';

const SERVER_URL = 'https://telegram-rng-server.onrender.com';

export default function InnerApp() {
  const initDataUnsafe = useWebAppInitDataUnsafe();
  const user = initDataUnsafe?.user;

  const [profile, setProfile] = useState(null);
  const [rngs, setRngs] = useState([]);
  const [rollingTitle, setRollingTitle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [wonTitle, setWonTitle] = useState(null);
  const [inventory, setInventory] = useState([]);

  useEffect(() => {
    if (!user) return;
    window.Telegram.WebApp.expand();

    fetch(`${SERVER_URL}/profile/${user.id}?username=${encodeURIComponent(user.username)}&first_name=${encodeURIComponent(user.first_name)}`)
      .then(r => r.json())
      .then(d => setProfile(d));

    fetch(`${SERVER_URL}/rngs`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setRngs(data);
      });

    fetch(`${SERVER_URL}/inventory/${user.id}`)
      .then(r => r.json())
      .then(data => setInventory(data));
  }, [user]);

  const roll = async () => {
    if (!user || rngs.length === 0) return;

    setLoading(true);
    let i = 0;

    const interval = setInterval(() => {
      setRollingTitle(rngs[i % rngs.length]);
      i++;
    }, 80);

    const res = await fetch(`${SERVER_URL}/roll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id })
    });
    const result = await res.json();

    setTimeout(() => {
      clearInterval(interval);
      setRollingTitle(null);
      setWonTitle(result); // показать выбор
      setLoading(false);
    }, 2000);
  };

  const keepTitle = async () => {
    setInventory(prev => [...prev, wonTitle]);
    setWonTitle(null); // скрыть модалку
  };

  const discardTitle = () => {
    setWonTitle(null);
  };

  const setActiveTitle = async (titleId) => {
    await fetch(`${SERVER_URL}/set-title`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, titleId })
    });

    setProfile(prev => ({
      ...prev,
      title: inventory.find(t => t.id === titleId)
    }));
  };

  const displayTitle = rollingTitle || profile?.title;

  if (!user) return <div className="container">Открой через Telegram Web App</div>;

  return (
    <div className="container">
      <h1 className="app-title">🎰 RNG Игра</h1>

      {profile && (
        <div className="card profile-card">
          <div className="greeting">Привет, {user.first_name}</div>
          <div className="title-display">
            <div className="title-label">Текущий титул</div>
            {displayTitle ? (
              <>
                <div className="title-name">{displayTitle.label}</div>
                <div className="title-chance">1 к {displayTitle.chance_ratio}</div>
              </>
            ) : (
              <div className="title-name">Без титула</div>
            )}
          </div>
        </div>
      )}

      <div className="card action-card">
        <button className="roll-button" onClick={roll} disabled={loading}>
          {loading ? 'Крутим...' : 'Крутить рулетку'}
        </button>
      </div>

      {wonTitle && (
        <div className="modal">
          <div className="modal-content">
            <h2>Ты выбил титул!</h2>
            <p>{wonTitle.label} (1 к {wonTitle.chance_ratio})</p>
            <button onClick={keepTitle}>Оставить</button>
            <button onClick={discardTitle}>Удалить</button>
          </div>
        </div>
      )}

      <div className="card inventory-card">
        <h2>🎒 Инвентарь</h2>
        {inventory.length === 0 ? (
          <p>Пусто...</p>
        ) : (
          <ul className="inventory-list">
            {inventory.map((item) => (
              <li
                key={item.id}
                className={`inventory-item ${profile?.title?.id === item.id ? 'active' : ''}`}
                onClick={() => setActiveTitle(item.id)}
              >
                <div>{item.label}</div>
                <div className="chance">1 к {item.chance_ratio}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
