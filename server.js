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
  process.env.SUPABASE_KEY
);

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

app.post('/roll', async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }

  const { data: rngs, error: rngError } = await supabase
    .from('rngs')
    .select();

  if (rngError || !rngs?.length) {
    return res.status(500).json({ error: 'Ошибка загрузки RNG' });
  }

  const selected = rollByChance(rngs);
  if (!selected) {
    return res.status(500).json({ error: 'Не удалось выбрать титул' });
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({ title_id: selected.id })
    .eq('id', userId);

  if (updateError) {
    return res.status(500).json({ error: 'Не удалось обновить пользователя', details: updateError.message });
  }

  const { error: historyError } = await supabase
    .from('user_rng_history')
    .insert({ user_id: userId, rng_id: selected.id });

  if (historyError) {
    return res.status(500).json({ error: 'Не удалось записать историю', details: historyError.message });
  }

  res.json(selected);
});

app.get('/profile/:id', async (req, res) => {
  const id = Number(req.params.id);
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
      .insert({ id }) 
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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));
