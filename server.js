import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Алгоритм выбора по шансам
function rollByChance(rngs) {
  const totalWeight = rngs.reduce((sum, rng) => sum + (1 / rng.chance_ratio), 0);
  const rand = Math.random() * totalWeight;
  let cumulative = 0;

  for (const rng of rngs) {
    cumulative += 1 / rng.chance_ratio;
    if (rand <= cumulative) return rng;
  }

  return rngs[rngs.length - 1];
}

// Эндпоинт: прокрутка рулетки
app.post('/roll', async (req, res) => {
  const { userId } = req.body;

  if (!userId) return res.status(400).json({ error: 'userId обязателен' });

  const { data: rngs, error: rngError } = await supabase.from('rngs').select();
  if (rngError || !rngs?.length) {
    return res.status(500).json({ error: 'Ошибка загрузки RNG' });
  }

  const selected = rollByChance(rngs);
  if (!selected) {
    return res.status(500).json({ error: 'Не удалось выбрать титул' });
  }

  const { error: historyError } = await supabase
    .from('user_rng_history')
    .insert({ user_id: userId, rng_id: selected.id });

  if (historyError) {
    return res.status(500).json({ error: 'Не удалось записать историю', details: historyError.message });
  }

  res.json(selected);
});

// Эндпоинт: получение профиля
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
        label,
        chance_ratio
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
          label,
          chance_ratio
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

// Эндпоинт: получить все RNG титулы
app.get('/rngs', async (req, res) => {
  const { data, error } = await supabase.from('rngs').select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Эндпоинт: инвентарь пользователя
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

// Эндпоинт: установка активного титула
app.post('/set-title', async (req, res) => {
  const { userId, titleId } = req.body;

  if (!userId || !titleId) {
    return res.status(400).json({ error: 'userId и titleId обязательны' });
  }

  const { error } = await supabase
    .from('users')
    .update({ title_id: titleId })
    .eq('id', userId);

  if (error) {
    return res.status(500).json({ error: 'Не удалось обновить титул', details: error.message });
  }

  res.json({ success: true });
});

// ✅ Эндпоинт: сохранить титул в инвентарь (если он не добавлен)
app.post('/inventory/keep', async (req, res) => {
  const { userId, rngId } = req.body;

  if (!userId || !rngId) {
    return res.status(400).json({ error: 'userId и rngId обязательны' });
  }

  // Проверка: уже есть титул?
  const { data: existing, error: checkError } = await supabase
    .from('user_rng_history')
    .select('id')
    .eq('user_id', userId)
    .eq('rng_id', rngId)
    .maybeSingle();

  if (checkError) {
    return res.status(500).json({ error: 'Ошибка при проверке титула', details: checkError.message });
  }

  // Если титул уже есть — успех без вставки
  if (existing) {
    return res.json({ success: true, message: 'Титул уже в инвентаре' });
  }

  // Добавляем титул
  const { error: insertError } = await supabase
    .from('user_rng_history')
    .insert({ user_id: userId, rng_id: rngId });

  if (insertError) {
    return res.status(500).json({ error: 'Не удалось сохранить титул в инвентарь', details: insertError.message });
  }

  res.json({ success: true, message: 'Титул добавлен в инвентарь' });
});

// Пинг-сервис
app.get('/ping', (req, res) => {
  console.log("Пинг получен:", new Date().toISOString());
  res.send("pong");
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));
