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

function rollByChance(rngs, boost = 1) {
  const validRngs = rngs.filter(rng => {
    const ratio = Number(rng.chance_ratio);
    return ratio > 0 && ratio >= boost;
  });

  if (validRngs.length === 0) return null; 

  const baseWeights = validRngs.map(rng => 1 / rng.chance_ratio);
  const maxWeight = Math.max(...baseWeights);

  const boostedWeights = baseWeights.map(w => {
    const rarityFactor = Math.log(maxWeight / w + 1); 
    return w * (1 + rarityFactor * (boost - 1));
  });

  const totalWeight = boostedWeights.reduce((acc, w) => acc + w, 0);
  let r = Math.random() * totalWeight;

  for (let i = 0; i < validRngs.length; i++) {
    r -= boostedWeights[i];
    if (r <= 0) return validRngs[i];
  }

  return validRngs[validRngs.length - 1];
}

app.post('/roll', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });

  const boostLevels = [
    { threshold: 10000, boost: 10000 },
    { threshold: 1000, boost: 1000 },
    { threshold: 300, boost: 100 },
    { threshold: 100, boost: 50 },
    { threshold: 10, boost: 10 },
  ];

  function getBoost(rolls) {
    for (const level of boostLevels) {
      if ((rolls + 1) % level.threshold === 0) return level.boost;
    }
    return 1;
  }


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
    .eq('active', true);

  if (rngError || !rngs?.length) {
    return res.status(500).json({ error: 'Ошибка загрузки RNG' });
  }

  const selected = rollByChance(rngs, boost);
  if (!selected) {
    return res.status(500).json({ error: 'Не удалось выбрать титул' });
  }

  await supabase.rpc('increment_rolls', { uid: Number(userId) });

  res.json({
    selected,
    rolls_count: rolls + 1,
    boost,
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
        label,
        chance_ratio,
        id
      ),
      inventory:user_rng_history (
        rngs (
          id,
          label,
          chance_ratio
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

  // Получить шанс титула
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

  res.json({ success: true, coins });
});

app.get('/ping', (req, res) => {
  console.log("Пинг получен:", new Date().toISOString());
  res.send("pong");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));
