import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

import { getBoost, rollByChance } from './utils/rollLogic.js'; 

dotenv.config();

const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.post('/roll', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('rolls_count')
    .eq('id', userId)
    .single();

  if (userError || !user) {
    return res.status(500).json({ error: 'Ошибка при загрузке пользователя' });
  }

  const rolls = user.rolls_count || 0;
  const boost = getBoost(rolls);

  const { data: rngs, error: rngError } = await supabase
    .from('rngs')
    .select('*')
    .eq('season', 0)
    .eq('active', true);

  if (rngError || !rngs?.length) {
    return res.status(500).json({ error: 'Ошибка загрузки RNG' });
  }

  const selected = rollByChance(rngs, boost);
  if (!selected) {
    return res.status(500).json({ error: 'Не удалось выбрать титул' });
  }

  await supabase.rpc('increment_rolls', { uid: Number(userId) });

  const { data: updatedUser, error: updatedUserError } = await supabase
    .from('users')
    .select('money')
    .eq('id', userId)
    .single();

  if (updatedUserError || !updatedUser) {
    return res.status(500).json({ error: 'Ошибка при получении баланса' });
  }

  res.json({
    selected,
    rolls_count: rolls + 1,
    boost,
    money: updatedUser.money,
    progress: {
      toDouble: 10 - ((rolls + 1) % 10),
      toTenfold: 300 - ((rolls + 1) % 300),
    },
  });
});

app.get('/profile/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { username = null, first_name = null } = req.query;

  if (!id || isNaN(id)) {
    return res.status(400).json({ error: 'Некорректный ID пользователя' });
  }

  let { data: user, error: userError } = await supabase
    .from('users')
    .select(`
      *,
      title: title_id (
        id,
        label,
        chance_ratio,
        season
      ),
      inventory:user_rng_history (
        rngs (
          id,
          label,
          chance_ratio,
          season
        )
      )
    `)
    .eq('id', id)
    .single();

  if (userError || !user) {
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({ id, username, first_name })
      .select(`
        *,
        title: title_id (
          id,
          label,
          chance_ratio,
          season
        )
      `)
      .single();

    if (insertError) {
      return res.status(500).json({ error: 'Ошибка при создании пользователя', details: insertError.message });
    }

    return res.json(newUser);
  }

  res.json(user);
});

app.get('/rngs', async (req, res) => {
  const { data, error } = await supabase
    .from('rngs')
    .select()
    .eq('active', true);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/inventory/:userId', async (req, res) => {
  const userId = req.params.userId;

  const { data, error } = await supabase
    .from('user_rng_history')
    .select('rngs(id, label, chance_ratio)')
    .eq('user_id', userId);

  if (error) {
    return res.status(500).json({ error: 'Не удалось загрузить инвентарь', details: error.message });
  }

  const unique = Object.values(
    data.reduce((acc, entry) => {
      const rng = entry.rngs;
      if (rng && !acc[rng.id]) {
        acc[rng.id] = rng;
      }
      return acc;
    }, {})
  );

  res.json(unique);
});

app.post('/set-title', async (req, res) => {
  const { userId, rngId } = req.body;

  if (!userId || !rngId) {
    return res.status(400).json({ error: 'userId и rngId обязательны' });
  }

  const { error } = await supabase
    .from('users')
    .update({ title_id: rngId })
    .eq('id', userId);

  if (error) {
    return res.status(500).json({ error: 'Не удалось обновить титул', details: error.message });
  }

  res.json({ success: true });
});

app.post('/inventory/keep', async (req, res) => {
  const { userId, rngId } = req.body;

  if (!userId || !rngId) {
    return res.status(400).json({ error: 'userId и rngId обязательны' });
  }

  const { error } = await supabase
    .from('user_rng_history')
    .upsert({ user_id: userId, rng_id: rngId }, { onConflict: ['user_id', 'rng_id'] });

  if (error) {
    return res.status(500).json({ error: 'Не удалось сохранить титул', details: error.message });
  }

  res.json({ success: true });
});

app.post('/sell', async (req, res) => {
  const { userId, rngId } = req.body;

  if (!userId || !rngId) {
    return res.status(400).json({ error: 'userId и rngId обязательны' });
  }

  const { data: rng, error: rngError } = await supabase
    .from('rngs')
    .select('chance_ratio')
    .eq('id', rngId)
    .single();

  if (rngError || !rng) {
    return res.status(500).json({ error: 'Ошибка при получении титула', details: rngError.message });
  }

  const coins = rng.chance_ratio;

  const { error: rpcError } = await supabase.rpc('add_money', {
    uid: userId,
    amount: coins
  });

  if (rpcError) {
    return res.status(500).json({ error: 'Ошибка при начислении монет', details: rpcError.message });
  }

  const { data: updatedUser, error: profileError } = await supabase
    .from('users')
    .select('money')
    .eq('id', userId)
    .single();

  if (profileError || !updatedUser) {
    return res.status(500).json({ error: 'Ошибка при получении обновлённого профиля', details: profileError?.message });
  }

  res.json({ success: true, coins, money: updatedUser.money });
});

app.post('/roll-seasonal', async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }

  const { data: season, error: seasonError } = await supabase
    .from('seasons')
    .select()
    .eq('active', true)
    .single();

  if (seasonError || !season) {
    return res.status(500).json({ error: 'Текущий сезон не найден' });
  }

  const SEASON_ID = season.id;
  const PRICE = season.price;

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('money, rolls_count')
    .eq('id', userId)
    .single();

  if (userError || !user) {
    return res.status(500).json({ error: 'Пользователь не найден' });
  }

  if (user.money < PRICE) {
    return res.status(400).json({ error: 'Недостаточно монет' });
  }

  const rolls = user.rolls_count || 0;

  const { data: rngs, error: rngsError } = await supabase
    .from('rngs')
    .select()
    .eq('season', SEASON_ID)
    .eq('active', true);

  if (rngsError || !rngs?.length) {
    return res.status(500).json({ error: 'Нет титулов для сезона' });
  }

  const boost = getBoost(rolls);
  const selected = rollByChance(rngs, boost);

  if (!selected) {
    return res.status(500).json({ error: 'Не удалось выбрать титул' });
  }

  const { error: moneyError } = await supabase
    .from('users')
    .update({ money: user.money - PRICE })
    .eq('id', userId);

  if (moneyError) {
    return res.status(500).json({ error: 'Не удалось списать монеты' });
  }

  await supabase.rpc('increment_rolls', { uid: Number(userId) });

  res.json({
    title: selected,
    boost,
    rolls_count: rolls + 1,
    progress: {
      toDouble: 10 - ((rolls + 1) % 10),
      toTenfold: 300 - ((rolls + 1) % 300),
    },
  });
});

app.get('/season', async (req, res) => {
  const { data: season, error } = await supabase
    .from('seasons')
    .select()
    .eq('active', true)
    .single();

  if (error || !season) {
    return res.status(500).json({ error: 'Текущий сезон не найден' });
  }

  res.json(season);
});

app.get('/ping', (req, res) => {
  console.log("Пинг получен:", new Date().toISOString());
  res.send("pong");
});

app.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));
