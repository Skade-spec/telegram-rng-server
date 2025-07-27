import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function rollByChance(rngs) {
  const pool = [];

  rngs.forEach(rng => {
    const entries = Math.max(1, Math.round(100 / rng.chance_ratio));
    for (let i = 0; i < entries; i++) {
      pool.push(rng);
    }
  });

  if (pool.length === 0) return null;

  return pool[Math.floor(Math.random() * pool.length)];
}


app.post('/roll', async (req, res) => {
  const { userId } = req.body;

  const { data: rngs, error } = await supabase.from('rngs').select();
  if (error || !rngs || rngs.length === 0) {
    return res.status(500).json({ error: 'RNG список пуст или не загружается' });
  }

  const selected = rollByChance(rngs);
  if (!selected) {
    return res.status(500).json({ error: 'Не удалось выбрать RNG' });
  }

  await supabase.from('users').update({ title_id: selected.id }).eq('id', userId);
  await supabase.from('user_rng_history').insert({ user_id: userId, rng_id: selected.id });

  res.json(selected);
});

app.get('/profile/:id', async (req, res) => {
  const { id } = req.params;
  const { data: user } = await supabase.from('users').select('*, title: title_id(label, chance_ratio)').eq('id', id).single();
  res.json(user);
});

app.listen(4000, () => console.log('Server running on port 4000'));