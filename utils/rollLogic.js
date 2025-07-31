export function getBoost(rolls) {
  const levels = [
    { threshold: 10000, boost: 10000 },
    { threshold: 1000, boost: 1000 },
    { threshold: 300, boost: 100 },
    { threshold: 100, boost: 50 },
    { threshold: 10, boost: 10 },
  ];
  for (const { threshold, boost } of levels) {
    if ((rolls + 1) % threshold === 0) return boost;
  }
  return 1;
}

export function rollByChance(rngs, boost = 1) {
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