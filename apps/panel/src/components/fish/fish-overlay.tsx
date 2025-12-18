import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface FishOverlayHandle {
  addFish: () => void;
  addShark: () => void;
  dropFoodAtClientPosition: (clientX: number, clientY: number) => void;
  scatterFood: (count?: number) => void;
  clearAll: () => void;
  togglePopulationChart: () => void;
  getPopulationSamples: () => Array<{ tMs: number; fish: number; sharks: number; food: number }>;
  triggerWave: () => void;
}

interface FishOverlayProps {
  panelRef: React.RefObject<HTMLDivElement>;
}

type Species = 'marine' | 'shark';

type Fish = {
  id: number;
  x: number;
  y: number;
  angle: number;
  speed: number;
  vx: number;
  vy: number;
  size: number; // radius baseline
  species: Species;
  // Marine fish appearance
  hue?: number;
  hue2?: number;
  stripeCount?: number;
  // Common sim state
  wanderT: number;
  targetFoodId: number | null; // marine food target
  targetFishId?: number | null; // shark prey target
  noFoodMs: number;
  createdAt: number;
  hungryTimeoutMs: number;
  // Shark-specific hunger cadence
  lastMealAtMs?: number;
  hungerCooldownMs?: number; // default 5 minutes
  // Shark appearance (stable)
  sharkShadeL?: number; // base lightness 45-60
  sharkTopShadeL?: number; // top darker band 28-38
  sharkPattern?: 'none' | 'spots' | 'stripe';
  sharkPatternSeed?: number;
  // Breeding and growth
  lastBreedAtMs?: number;
  growthTargetSize?: number;
  growthRatePerMs?: number;
};

type Food = {
  id: number;
  x: number;
  y: number;
  targetY: number;
  vy: number;
  settled: boolean;
};

const MAX_FISH = 16;
const MAX_FOOD = 64;
const MAX_SHARKS = 4;
const HUNGRY_INTERVAL_MS = 60 * 1000; // sharks must feed at least once a minute

type Wave = {
  id: number;
  startAt: number;
  durationMs: number;
  // Line defined by point and normal; we animate along direction
  // We'll render as a series of parallel translucent lines moving
  x0: number; // starting point x
  y0: number; // starting point y
  angle: number; // travel direction angle (radians)
  speed: number; // px per second
  spacing: number; // spacing between crests
  crestCount: number; // number of crests to render
};

export default forwardRef<FishOverlayHandle, FishOverlayProps>(function FishOverlay({ panelRef }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const fishRef = useRef<Fish[]>([]);
  const foodRef = useRef<Food[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number>(0);
  const resizeObsRef = useRef<ResizeObserver | null>(null);
  const wavesRef = useRef<Wave[]>([]);
  const nextWaveAtRef = useRef<number>(Date.now() + 1200 + Math.random() * 1200);
  // Auto food spawn accumulator
  const foodSpawnAccRef = useRef<number>(0);
  // Population tracking
  const popStartAtRef = useRef<number>(Date.now());
  const popSamplesRef = useRef<Array<{ tMs: number; fish: number; sharks: number; food: number }>>([]);
  const lastPopSampleAtRef = useRef<number>(Date.now());
  const showPopChartRef = useRef<boolean>(false);
  const popWinRef = useRef<Window | null>(null);
  const lastPopSendAtRef = useRef<number>(0);
  // Breeding queue (delayed births)
  const breedQueueRef = useRef<Array<{ species: Species; aId: number; bId: number; dueAt: number }>>([]);

  // Coordinate helpers
  const clientToLocal = (clientX: number, clientY: number) => {
    const panel = panelRef.current;
    if (!panel) return { x: 0, y: 0 };
    const rect = panel.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const ensureCtx = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    if (!ctxRef.current) {
      ctxRef.current = canvas.getContext('2d', { alpha: true });
    }
    return ctxRef.current;
  };

  const resizeCanvas = () => {
    const panel = panelRef.current;
    const canvas = canvasRef.current;
    if (!panel || !canvas) return;
    const rect = panel.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = ensureCtx();
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  // Public API
  useImperativeHandle(ref, () => ({
    addFish: () => {
      const panel = panelRef.current;
      if (!panel) return;
      // Count only marine fish against MAX_FISH so sharks can coexist
      const marineCount = fishRef.current.filter(f => f.species === 'marine').length;
      if (marineCount >= MAX_FISH) return;
      const rect = panel.getBoundingClientRect();
      const x = Math.random() * rect.width;
      const y = Math.random() * rect.height;
      // Marine fish (tropical) - smaller
      const size = 9 + Math.random() * 5;
      const speed = 0.48 + Math.random() * 0.32; // slower, relaxing
      const angle = Math.random() * Math.PI * 2;
      const hues = [200, 205, 210, 215, 220, 40, 45, 50, 180, 185, 190]; // blues, teals, yellows
      const hue = hues[Math.floor(Math.random() * hues.length)];
      const hue2 = Math.random() < 0.5 ? hues[Math.floor(Math.random() * hues.length)] : undefined;
      const stripeCount = Math.random() < 0.6 ? (2 + Math.floor(Math.random() * 3)) : 0;
      const id = Date.now() + Math.floor(Math.random() * 1000);
      const hungryTimeoutMs = 180000 + Math.random() * 120000; // 3-5 minutes
      fishRef.current.push({ id, x, y, angle, speed, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size, species: 'marine', hue, hue2, stripeCount, wanderT: Math.random() * 1000, targetFoodId: null, targetFishId: null, noFoodMs: 0, createdAt: Date.now(), hungryTimeoutMs });
    },
    addShark: () => {
      const panel = panelRef.current;
      if (!panel) return;
      const sharkCount = fishRef.current.filter(f => f.species === 'shark').length;
      if (sharkCount >= MAX_SHARKS) return;
      const rect = panel.getBoundingClientRect();
      const x = Math.random() * rect.width;
      const y = Math.random() * rect.height;
      const size = 18 + Math.random() * 8; // still larger than fish
      const speed = 0.6 + Math.random() * 0.4; // a bit quicker than fish but relaxed
      const angle = Math.random() * Math.PI * 2;
      const id = Date.now() + Math.floor(Math.random() * 1000);
      const now = Date.now();
      const sharkShadeL = 48 + Math.floor(Math.random() * 10);
      const sharkTopShadeL = 28 + Math.floor(Math.random() * 10);
      const patterns: Array<'none' | 'spots' | 'stripe'> = ['none', 'spots', 'stripe'];
      const sharkPattern = patterns[Math.floor(Math.random() * patterns.length)];
      const sharkPatternSeed = Math.floor(Math.random() * 1000);
      fishRef.current.push({ id, x, y, angle, speed, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size, species: 'shark', wanderT: Math.random() * 1000, targetFoodId: null, targetFishId: null, noFoodMs: 0, createdAt: now, hungryTimeoutMs: 99999999, lastMealAtMs: now, hungerCooldownMs: HUNGRY_INTERVAL_MS, sharkShadeL, sharkTopShadeL, sharkPattern, sharkPatternSeed });
    },
    dropFoodAtClientPosition: (clientX: number, clientY: number) => {
      const { x, y } = clientToLocal(clientX, clientY);
      if (foodRef.current.length >= MAX_FOOD) foodRef.current.shift();
      const id = Date.now() + Math.floor(Math.random() * 1000);
      // Place directly at clicked position
      foodRef.current.push({ id, x, y, targetY: y, vy: 0, settled: true });
    },
    scatterFood: (count: number = 24) => {
      const panel = panelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const width = rect.width; const height = rect.height;
      const minY = 80; // avoid header
      const maxY = Math.max(minY + 20, height - 40);
      for (let i = 0; i < count; i++) {
        if (foodRef.current.length >= MAX_FOOD) break;
        const id = Date.now() + Math.floor(Math.random() * 1000) + i;
        const x = Math.random() * width;
        const y = minY + Math.random() * (maxY - minY);
        foodRef.current.push({ id, x, y, targetY: y, vy: 0, settled: true });
      }
    },
    clearAll: () => {
      fishRef.current = [];
      foodRef.current = [];
      wavesRef.current = [];
    },
    togglePopulationChart: () => {
      // Toggle in-canvas populations panel
      showPopChartRef.current = !showPopChartRef.current;
      try { if (popWinRef.current && !popWinRef.current.closed) popWinRef.current.close(); } catch {}
      popWinRef.current = null;
    }
    ,
    getPopulationSamples: () => popSamplesRef.current.slice(-600)
    ,
    triggerWave: () => {
      const panel = panelRef.current;
      const rect = panel?.getBoundingClientRect();
      const width = rect?.width || 0;
      const height = rect?.height || 0;
      const angle = Math.random() * Math.PI * 2;
      const margin = 60;
      const dirX = Math.cos(angle);
      const x0 = dirX < 0 ? width + margin : -margin;
      const y0 = Math.random() * height;
      wavesRef.current.push({ id: Date.now(), startAt: Date.now(), durationMs: 5000, x0, y0, angle, speed: 140, spacing: 16, crestCount: 12 });
    }
  }), []);

  // Simulation
  const update = (dt: number) => {
    const now = Date.now();
    // Waves: spawn periodically traveling across panel at varying angles
    if (now >= nextWaveAtRef.current) {
      const panel = panelRef.current;
      const rect = panel?.getBoundingClientRect();
      const width = rect?.width || 0;
      const height = rect?.height || 0;
      const angle = (Math.random() * 1.4 - 0.7) + (Math.random() < 0.5 ? 0 : Math.PI); // wider range of slants
      // Start slightly off-screen on one side
      const margin = 80;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      const x0 = dirX < 0 ? width + margin : -margin;
      const y0 = Math.random() * height;
      const durationMs = 5000 + Math.random() * 3000;
      const speed = 120 + Math.random() * 80; // faster waves
      const spacing = 16 + Math.random() * 8;
      const crestCount = 10 + Math.floor(Math.random() * 6);
      wavesRef.current.push({ id: now, startAt: now, durationMs, x0, y0, angle, speed, spacing, crestCount });
      nextWaveAtRef.current = now + 1600 + Math.random() * 1600;
    }
    // Clean up finished waves
    wavesRef.current = wavesRef.current.filter(w => now - w.startAt < w.durationMs);

    // Auto food spawning: fixed 10 pellets per minute when any entity present
    const anyPresent = fishRef.current.length > 0;
    if (anyPresent) {
      const lambdaPerMs = 10 / 60000; // pellets per ms
      const expected = lambdaPerMs * dt + foodSpawnAccRef.current;
      let toSpawn = Math.floor(expected);
      foodSpawnAccRef.current = expected - toSpawn;
      if (toSpawn > 0) {
        const panel2 = panelRef.current;
        const rect2 = panel2?.getBoundingClientRect();
        const width2 = rect2?.width || 0;
        const height2 = rect2?.height || 0;
        const minY2 = 80; // avoid header
        const maxY2 = Math.max(minY2 + 20, height2 - 40);
        while (toSpawn-- > 0 && foodRef.current.length < MAX_FOOD) {
          const id2 = now + Math.floor(Math.random() * 1000) + toSpawn;
          const x2 = Math.random() * width2;
          const y2 = minY2 + Math.random() * (maxY2 - minY2);
          foodRef.current.push({ id: id2, x: x2, y: y2, targetY: y2, vy: 0, settled: true });
        }
      }
    }
    // Population sampling (~1Hz)
    if (now - lastPopSampleAtRef.current >= 1000) {
      const fishCount = fishRef.current.filter(f => f.species === 'marine').length;
      const sharkCount = fishRef.current.filter(f => f.species === 'shark').length;
      const foodCount = foodRef.current.length;
      popSamplesRef.current.push({ tMs: now - popStartAtRef.current, fish: fishCount, sharks: sharkCount, food: foodCount });
      lastPopSampleAtRef.current = now;
      if (popSamplesRef.current.length > 600) popSamplesRef.current.shift(); // keep last 10 minutes
      // Send to popup if open
      if (popWinRef.current && !popWinRef.current.closed) {
        try { popWinRef.current.postMessage({ type: 'popSamples', samples: popSamplesRef.current.slice(-600) }, '*'); } catch {}
      } else if (showPopChartRef.current) {
        showPopChartRef.current = false; popWinRef.current = null;
      }
    }

    // Food availability
    const settledFood = foodRef.current.filter(f => f.settled);
    const anyFood = settledFood.length > 0;

    // Target selection
    const allSharks = fishRef.current.filter(f => f.species === 'shark');
    const hungrySharks = allSharks; // sharks always dangerous; fish avoid them
    for (const fish of fishRef.current) {
      fish.noFoodMs = anyFood ? 0 : (fish.noFoodMs + dt);
      if (fish.species === 'marine') {
        // Choose nearest food
        if (settledFood.length > 0) {
          if (fish.targetFoodId == null || !foodRef.current.find(ff => ff.id === fish.targetFoodId)) {
            let minD = Infinity; let target: Food | null = null;
            for (const ff of settledFood) {
              const dx = ff.x - fish.x; const dy = ff.y - fish.y;
              const d2 = dx * dx + dy * dy;
              if (d2 < minD) { minD = d2; target = ff; }
            }
            fish.targetFoodId = target ? target.id : null;
          }
        } else {
          fish.targetFoodId = null;
        }
        fish.targetFishId = null; // marine fish don't target fish
      } else {
        // Shark: only hunt prey within vision radius
        fish.targetFoodId = null; // sharks ignore pellets
        const visionRadius = 150; // Sharks can only see fish within 150 pixels
        const visionRadiusSq = visionRadius * visionRadius;
        
        // If currently tracking a target, check if it's still in range
        if (fish.targetFishId) {
          const currentTarget = fishRef.current.find(f => f.id === fish.targetFishId && f.species === 'marine');
          if (currentTarget) {
            const dx = currentTarget.x - fish.x;
            const dy = currentTarget.y - fish.y;
            const d2 = dx * dx + dy * dy;
            // Keep tracking if within extended range (1.5x vision for pursuit)
            if (d2 > visionRadiusSq * 2.25) {
              fish.targetFishId = null; // Lost sight of target
            }
          } else {
            fish.targetFishId = null;
          }
        }
        
        // Look for new prey only within vision radius
        if (!fish.targetFishId) {
          let minD = Infinity; 
          let target: Fish | null = null;
          for (const prey of fishRef.current) {
            if (prey.species !== 'marine') continue;
            const dx = prey.x - fish.x; 
            const dy = prey.y - fish.y;
            const d2 = dx * dx + dy * dy;
            // Only consider prey within vision radius
            if (d2 < visionRadiusSq && d2 < minD) { 
              minD = d2; 
              target = prey; 
            }
          }
          fish.targetFishId = target ? target.id : null;
        }
      }
    }

    // Movement and avoidance
    const panel = panelRef.current;
    const rect = panel?.getBoundingClientRect();
    const width = rect?.width || 0;
    const height = rect?.height || 0;
    for (const fish of fishRef.current) {
      const maxTurn = 0.0022 * dt; // gentler turns for fluid motion
      const wanderTurn = 0.0008 * dt * Math.sin(fish.wanderT * 0.002);
      fish.wanderT += dt;
      let desiredAngle = fish.angle + wanderTurn;

      if (fish.species === 'marine') {
        // Avoid sharks that are nearby (fish can sense danger)
        let avoidDx = 0; let avoidDy = 0; let avoidWeight = 0;
        for (const sh of allSharks) {
          const dx = fish.x - sh.x; const dy = fish.y - sh.y;
          const d = Math.hypot(dx, dy);
          // Fish have similar detection range as shark vision (they can sense predators)
          const detectionRadius = 130; // Slightly larger than shark vision for safety
          if (d < detectionRadius && d > 0.0001) {
            // Stronger avoidance if shark is actively hunting this fish
            const isHuntingMe = sh.targetFishId === fish.id;
            const w = ((detectionRadius - d) / detectionRadius) * (isHuntingMe ? 1.5 : 0.8);
            avoidDx += (dx / d) * w;
            avoidDy += (dy / d) * w;
            avoidWeight += w;
          }
        }
        if (avoidWeight > 0.0001) {
          desiredAngle = Math.atan2(avoidDy, avoidDx);
        } else if (fish.targetFoodId) {
          const target = foodRef.current.find(ff => ff.id === fish.targetFoodId);
          if (target) {
            const dx = target.x - fish.x; const dy = target.y - fish.y;
            desiredAngle = Math.atan2(dy, dx);
          } else {
            fish.targetFoodId = null;
          }
        }
      } else {
        // Shark: seek prey if in sight, otherwise wander
        if (fish.targetFishId) {
          const target = fishRef.current.find(ff => ff.id === fish.targetFishId);
          if (target && target.species === 'marine') {
            // Predict target future position based on current velocity
            const relX = target.x - fish.x; const relY = target.y - fish.y;
            const relVx = target.vx - fish.vx; const relVy = target.vy - fish.vy;
            const relV2 = relVx * relVx + relVy * relVy;
            let tLead = 0;
            if (relV2 > 0.0001) {
              const relR = Math.hypot(relX, relY);
              tLead = Math.min(600, (relR / (Math.hypot(fish.vx, fish.vy) + 0.0001)) * 300);
            }
            const futureX = target.x + target.vx * (tLead * 0.016);
            const futureY = target.y + target.vy * (tLead * 0.016);
            const dx = futureX - fish.x; const dy = futureY - fish.y;
            desiredAngle = Math.atan2(dy, dx);
          } else {
            fish.targetFishId = null;
          }
        } else {
          // When not hunting, sharks wander more actively
          // Add stronger wandering for sharks to make them patrol the area
          const sharkWanderTurn = 0.0012 * dt * Math.sin(fish.wanderT * 0.003);
          desiredAngle = fish.angle + wanderTurn + sharkWanderTurn;
        }
      }

      // Turn toward desired angle smoothly
      let delta = normalizeAngle(desiredAngle - fish.angle);
      delta = clamp(delta, -maxTurn, maxTurn);
      fish.angle = normalizeAngle(fish.angle + delta);

      // Swim forward
      const isChasingFood = fish.species === 'marine' && !!fish.targetFoodId;
      const isChasingPrey = fish.species === 'shark' && !!fish.targetFishId;
      const chaseBoost = isChasingFood || isChasingPrey ? 1.35 : 1;
      const targetSpeed = fish.speed * chaseBoost;
      // Smooth velocity interpolation for fluid movement
      const desiredVx = Math.cos(fish.angle) * targetSpeed;
      const desiredVy = Math.sin(fish.angle) * targetSpeed;
      const lerp = 1 - Math.pow(0.0006, dt / 16.67); // stronger smoothing for more fluid motion
      fish.vx = fish.vx + (desiredVx - fish.vx) * lerp;
      fish.vy = fish.vy + (desiredVy - fish.vy) * lerp;
      fish.x += fish.vx * dt * 0.06;
      fish.y += fish.vy * dt * 0.06;
      // Growth toward target size
      if (fish.growthTargetSize && fish.growthRatePerMs && fish.size < fish.growthTargetSize) {
        fish.size = Math.min(fish.growthTargetSize, fish.size + fish.growthRatePerMs * dt);
      }

      // Wrap around (toroidal)
      const margin = 24;
      if (fish.x < -margin) fish.x = width + margin;
      else if (fish.x > width + margin) fish.x = -margin;
      if (fish.y < -margin) fish.y = height + margin;
      else if (fish.y > height + margin) fish.y = -margin;
    }

    // Eating
    // Marine fish eat pellets
    for (const fish of fishRef.current) {
      if (fish.species !== 'marine' || !fish.targetFoodId) continue;
      const idx = foodRef.current.findIndex(ff => ff.id === fish.targetFoodId && ff.settled);
      if (idx >= 0) {
        const ff = foodRef.current[idx];
        const dx = ff.x - fish.x; const dy = ff.y - fish.y;
        const dist = Math.hypot(dx, dy);
        if (dist < fish.size * 0.9) {
          foodRef.current.splice(idx, 1);
          fish.targetFoodId = null;
        }
      }
    }

    // Sharks eat marine fish constantly
    const removedIds = new Set<number>();
    for (const shark of fishRef.current) {
      if (shark.species !== 'shark') continue;
      if (!shark.targetFishId) continue;
      const preyIdx = fishRef.current.findIndex(f => f.id === shark.targetFishId && f.species === 'marine');
      if (preyIdx >= 0) {
        const prey = fishRef.current[preyIdx];
        const dx = prey.x - shark.x; const dy = prey.y - shark.y;
        const dist = Math.hypot(dx, dy);
        const catchRadius = Math.max(shark.size * 1.2, prey.size * 0.9);
        if (dist < catchRadius) {
          removedIds.add(prey.id);
          shark.targetFishId = null;
          shark.lastMealAtMs = now; // fed; won't hunt for 5 minutes
        }
      }
    }
    if (removedIds.size > 0) {
      fishRef.current = fishRef.current.filter(f => !removedIds.has(f.id));
    }

    // Sharks die if not fed within 60s
    const survived: Fish[] = [];
    for (const f of fishRef.current) {
      if (f.species === 'shark') {
        const lastEat = f.lastMealAtMs || f.createdAt;
        if (now - lastEat > HUNGRY_INTERVAL_MS) {
          continue; // shark dies
        }
      }
      survived.push(f);
    }
    fishRef.current = survived;

    // Breeding detection and scheduling
    const scheduleBreed = (a: Fish, b: Fish, species: Species) => {
      const nowMs = now;
      const cooldown = 180000; // 3 minute cooldown between breeding
      if ((a.lastBreedAtMs && nowMs - a.lastBreedAtMs < cooldown) || (b.lastBreedAtMs && nowMs - b.lastBreedAtMs < cooldown)) return;
      const exists = breedQueueRef.current.some(q => (q.aId === a.id && q.bId === b.id && q.species === species) || (q.aId === b.id && q.bId === a.id && q.species === species));
      if (exists) return;
      breedQueueRef.current.push({ species, aId: a.id, bId: b.id, dueAt: nowMs + 60000 });
      a.lastBreedAtMs = nowMs; b.lastBreedAtMs = nowMs;
    };
    // Breed marine fish
    const marines = fishRef.current.filter(f => f.species === 'marine');
    for (let i = 0; i < marines.length; i++) {
      for (let j = i + 1; j < marines.length; j++) {
        const a = marines[i], b = marines[j];
        const dx = a.x - b.x, dy = a.y - b.y; const dist = Math.hypot(dx, dy);
        const thresh = Math.max(20, (a.size + b.size) * 0.6);
        if (dist < thresh) scheduleBreed(a, b, 'marine');
      }
    }
    // Breed sharks
    const sharks = fishRef.current.filter(f => f.species === 'shark');
    for (let i = 0; i < sharks.length; i++) {
      for (let j = i + 1; j < sharks.length; j++) {
        const a = sharks[i], b = sharks[j];
        const dx = a.x - b.x, dy = a.y - b.y; const dist = Math.hypot(dx, dy);
        const thresh = Math.max(26, (a.size + b.size) * 0.55);
        if (dist < thresh) scheduleBreed(a, b, 'shark');
      }
    }
    // Process due births
    if (breedQueueRef.current.length > 0) {
      const rectBirth = panelRef.current?.getBoundingClientRect();
      const wBirth = rectBirth?.width || 0; const hBirth = rectBirth?.height || 0;
      const remain: typeof breedQueueRef.current = [];
      for (const q of breedQueueRef.current) {
        if (now >= q.dueAt) {
          const pa = fishRef.current.find(f => f.id === q.aId && f.species === q.species);
          const pb = fishRef.current.find(f => f.id === q.bId && f.species === q.species);
          if (pa && pb) {
            const x = (pa.x + pb.x) / 2 + (Math.random() * 10 - 5);
            const y = (pa.y + pb.y) / 2 + (Math.random() * 10 - 5);
            const angle = Math.random() * Math.PI * 2;
            if (q.species === 'marine') {
              const size0 = 6 + Math.random() * 2; const maxSize = 12 + Math.random() * 3;
              const growthMs = 90000 + Math.random() * 60000; // 1.5-2.5 min
              const speed0 = 0.5 + Math.random() * 0.25;
              const hues = [200,205,210,215,220,40,45,50,180,185,190];
              const hue = hues[Math.floor(Math.random() * hues.length)];
              const hue2 = Math.random() < 0.5 ? hues[Math.floor(Math.random() * hues.length)] : undefined;
              const stripeCount = Math.random() < 0.6 ? (2 + Math.floor(Math.random() * 3)) : 0;
              const idNew = Date.now() + Math.floor(Math.random() * 1000);
              fishRef.current.push({
                id: idNew, x: Math.max(0, Math.min(wBirth, x)), y: Math.max(0, Math.min(hBirth, y)),
                angle, speed: speed0, vx: Math.cos(angle) * speed0, vy: Math.sin(angle) * speed0,
                size: size0, species: 'marine', hue, hue2, stripeCount, wanderT: Math.random() * 1000,
                targetFoodId: null, targetFishId: null, noFoodMs: 0, createdAt: now,
                hungryTimeoutMs: 180000 + Math.random() * 120000, lastMealAtMs: undefined,
                hungerCooldownMs: undefined, sharkShadeL: undefined, sharkTopShadeL: undefined,
                sharkPattern: undefined, sharkPatternSeed: undefined, lastBreedAtMs: undefined,
                growthTargetSize: maxSize, growthRatePerMs: (maxSize - size0) / growthMs
              });
            } else {
              const size0 = 12 + Math.random() * 3; const maxSize = 24 + Math.random() * 6;
              const growthMs = 120000 + Math.random() * 60000; // 2-3 min
              const speed0 = 0.7 + Math.random() * 0.3;
              const idNew = Date.now() + Math.floor(Math.random() * 1000);
              const shade = 48 + Math.floor(Math.random() * 10);
              const topShade = 28 + Math.floor(Math.random() * 10);
              const patterns: Array<'none'|'spots'|'stripe'> = ['none','spots','stripe'];
              const pat = patterns[Math.floor(Math.random() * patterns.length)];
              const patSeed = Math.floor(Math.random() * 1000);
              fishRef.current.push({
                id: idNew, x: Math.max(0, Math.min(wBirth, x)), y: Math.max(0, Math.min(hBirth, y)),
                angle, speed: speed0, vx: Math.cos(angle) * speed0, vy: Math.sin(angle) * speed0,
                size: size0, species: 'shark', wanderT: Math.random() * 1000,
                targetFoodId: null, targetFishId: null, noFoodMs: 0, createdAt: now,
                hungryTimeoutMs: 99999999, lastMealAtMs: now, hungerCooldownMs: HUNGRY_INTERVAL_MS,
                sharkShadeL: shade, sharkTopShadeL: topShade, sharkPattern: pat, sharkPatternSeed: patSeed,
                lastBreedAtMs: undefined, growthTargetSize: maxSize, growthRatePerMs: (maxSize - size0) / growthMs
              });
            }
          }
        } else {
          remain.push(q);
        }
      }
      breedQueueRef.current = remain;
    }

    // Cull marine fish with no food for > hungryTimeoutMs
    if (!anyFood && fishRef.current.some(f => f.species === 'marine')) {
      fishRef.current = fishRef.current.filter(f => f.species !== 'marine' || f.noFoodMs <= f.hungryTimeoutMs);
    }
  };

  const draw = () => {
    const ctxRaw = ensureCtx();
    const canvasRaw = canvasRef.current;
    if (!ctxRaw || !canvasRaw) return;
    const _ctx = ctxRaw as CanvasRenderingContext2D;
    const _canvas = canvasRaw as HTMLCanvasElement;
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    // Draw realistic surf waves with foam and multiple crests
    for (const w of wavesRef.current) {
      const t = (Date.now() - w.startAt) / w.durationMs;
      if (t <= 0 || t >= 1) continue;
      const prog = t;
      const travel = prog * w.speed * (w.durationMs / 1000);
      const baseX = w.x0 + Math.cos(w.angle) * travel;
      const baseY = w.y0 + Math.sin(w.angle) * travel;
      const nx = -Math.sin(w.angle); // normal vector for crest spacing
      const ny = Math.cos(w.angle);
      _ctx.save();
      
      // Draw multiple wave layers for depth
      for (let layer = 0; layer < 3; layer++) {
        const layerOffset = layer * 8;
        const layerAlpha = 0.25 - layer * 0.08;
        
        for (let i = -Math.floor(w.crestCount / 2); i <= Math.floor(w.crestCount / 2); i++) {
          const offset = i * w.spacing + layerOffset;
          const x = baseX + nx * offset;
          const y = baseY + ny * offset;
          
          // Main wave crest with curve
          const crestAlpha = layerAlpha * (1 - Math.abs(i) / (w.crestCount / 2 + 1)) * (1 - prog * 0.7);
          const seg = 150 + Math.sin(Date.now() * 0.001 + i) * 20; // Varying segment length
          
          // Wave gradient
          const gradient = _ctx.createLinearGradient(
            x - Math.cos(w.angle) * seg * 0.5, 
            y - Math.sin(w.angle) * seg * 0.5,
            x + Math.cos(w.angle) * seg * 0.5, 
            y + Math.sin(w.angle) * seg * 0.5
          );
          gradient.addColorStop(0, `rgba(96,165,250,0)`);
          gradient.addColorStop(0.3, `rgba(96,165,250,${crestAlpha})`);
          gradient.addColorStop(0.5, `rgba(147,197,253,${crestAlpha * 1.2})`);
          gradient.addColorStop(0.7, `rgba(96,165,250,${crestAlpha})`);
          gradient.addColorStop(1, `rgba(96,165,250,0)`);
          
          _ctx.strokeStyle = gradient;
          _ctx.lineWidth = 2.5 - layer * 0.5;
          _ctx.beginPath();
          
          // Draw curved wave crest
          const points = 20;
          for (let p = 0; p <= points; p++) {
            const t = (p / points) - 0.5;
            const px = x + Math.cos(w.angle) * seg * t;
            const py = y + Math.sin(w.angle) * seg * t;
            // Add sine wave perturbation for realistic wave shape
            const waveHeight = Math.sin(t * Math.PI * 2 + Date.now() * 0.002) * 3;
            const wpx = px + nx * waveHeight;
            const wpy = py + ny * waveHeight;
            
            if (p === 0) _ctx.moveTo(wpx, wpy);
            else _ctx.lineTo(wpx, wpy);
          }
          _ctx.stroke();
          
          // Add foam dots at crest peaks
          if (layer === 0 && Math.random() < 0.3) {
            _ctx.fillStyle = `rgba(255,255,255,${crestAlpha * 0.8})`;
            const foamCount = 3 + Math.floor(Math.random() * 4);
            for (let f = 0; f < foamCount; f++) {
              const ft = (Math.random() - 0.5) * 0.8;
              const fx = x + Math.cos(w.angle) * seg * ft + (Math.random() - 0.5) * 10;
              const fy = y + Math.sin(w.angle) * seg * ft + (Math.random() - 0.5) * 10;
              _ctx.beginPath();
              _ctx.arc(fx, fy, 1 + Math.random(), 0, Math.PI * 2);
              _ctx.fill();
            }
          }
        }
      }
      _ctx.restore();
    }
    // Draw food
    for (const f of foodRef.current) {
      _ctx.save();
      _ctx.globalAlpha = 0.6; // Reduced from 0.9 (33% more transparent)
      _ctx.fillStyle = '#eab308'; // amber-500
      _ctx.beginPath();
      _ctx.arc(f.x, f.y, 3, 0, Math.PI * 2);
      _ctx.fill();
      _ctx.restore();
    }
    // Draw fish (marine and sharks) facing forward along +X
    for (const fish of fishRef.current) {
      _ctx.save();
      _ctx.translate(fish.x, fish.y);
      _ctx.rotate(fish.angle);
      if (fish.species === 'marine') {
        const bodyL = fish.size * 2.0;
        const bodyW = fish.size * 1.25;
        // Body base
        _ctx.globalAlpha = 0.27; // Reduced from 0.4 (33% more transparent)
        _ctx.fillStyle = `hsl(${fish.hue ?? 200} 80% 60%)`;
        drawEllipse(_ctx, 0, 0, bodyL, bodyW);
        _ctx.fill();
        // Stripes
        if ((fish.stripeCount ?? 0) > 0) {
          _ctx.globalAlpha = 0.2; // Reduced from 0.3 (33% more transparent)
          _ctx.fillStyle = `hsl(${fish.hue2 ?? (fish.hue ?? 200)} 90% 50%)`;
          const n = fish.stripeCount || 0;
          for (let i = 0; i < n; i++) {
            const t = (i + 1) / (n + 1);
            drawEllipse(_ctx, bodyL * (t - 0.5), 0, bodyL * 0.22, bodyW * 0.9);
            _ctx.fill();
          }
        }
        // Tail fin
        _ctx.globalAlpha = 0.19; // Reduced from 0.28 (33% more transparent)
        _ctx.fillStyle = `hsl(${fish.hue ?? 200} 70% 45%)`;
        _ctx.beginPath();
        _ctx.moveTo(-bodyL * 0.55, 0);
        _ctx.lineTo(-bodyL * 0.75, -bodyW * 0.4);
        _ctx.lineTo(-bodyL * 0.75, bodyW * 0.4);
        _ctx.closePath();
        _ctx.fill();
        // No dorsal fin (bird's-eye minimal style)
      } else {
        // Shark
        const bodyL = fish.size * 2.6;
        const bodyW = fish.size * 1.1;
        _ctx.globalAlpha = 0.23; // Reduced from 0.35 (33% more transparent)
        _ctx.fillStyle = `hsl(210 5% ${fish.sharkShadeL ?? 52}%)`;
        drawEllipse(_ctx, 0, 0, bodyL, bodyW);
        _ctx.fill();
        // Top darker
        _ctx.globalAlpha = 0.19; // Reduced from 0.28 (33% more transparent)
        _ctx.fillStyle = `hsl(210 8% ${fish.sharkTopShadeL ?? 33}%)`;
        drawEllipse(_ctx, bodyL * 0.05, -bodyW * 0.15, bodyL * 1.1, bodyW * 0.6);
        _ctx.fill();
        // Dorsal fin
        _ctx.globalAlpha = 0.21; // Reduced from 0.32 (33% more transparent)
        _ctx.fillStyle = 'hsl(210 10% 30%)';
        _ctx.beginPath();
        _ctx.moveTo(bodyL * 0.05, -bodyW * 0.55);
        _ctx.lineTo(bodyL * 0.2, -bodyW * 1.0);
        _ctx.lineTo(bodyL * 0.3, -bodyW * 0.55);
        _ctx.closePath();
        _ctx.fill();
        // Tail
        _ctx.globalAlpha = 0.2; // Reduced from 0.3 (33% more transparent)
        _ctx.beginPath();
        _ctx.moveTo(-bodyL * 0.6, 0);
        _ctx.lineTo(-bodyL * 0.85, -bodyW * 0.35);
        _ctx.lineTo(-bodyL * 0.85, bodyW * 0.35);
        _ctx.closePath();
        _ctx.fill();
        // Side fins
        _ctx.globalAlpha = 0.19; // Reduced from 0.28 (33% more transparent)
        _ctx.beginPath();
        _ctx.moveTo(-bodyL * 0.05, bodyW * 0.35);
        _ctx.lineTo(bodyL * 0.2, bodyW * 0.65);
        _ctx.lineTo(bodyL * 0.1, bodyW * 0.25);
        _ctx.closePath();
        _ctx.fill();
        _ctx.beginPath();
        _ctx.moveTo(-bodyL * 0.05, -bodyW * 0.35);
        _ctx.lineTo(bodyL * 0.2, -bodyW * 0.65);
        _ctx.lineTo(bodyL * 0.1, -bodyW * 0.25);
        _ctx.closePath();
        _ctx.fill();
        // Optional patterns (spots or stripe) for variation
        if (fish.sharkPattern && fish.sharkPattern !== 'none') {
          _ctx.save();
          _ctx.globalAlpha = 0.12; // Reduced from 0.18 (33% more transparent)
          _ctx.fillStyle = 'hsl(210 8% 20%)';
          if (fish.sharkPattern === 'spots') {
            // deterministic pseudo random based on seed
            const n = 6;
            for (let i = 0; i < n; i++) {
              const t = ((i * 97 + (fish.sharkPatternSeed || 0)) % 1000) / 1000;
              const px = -bodyL * 0.2 + t * bodyL * 0.8;
              const py = ((Math.sin(t * 12.3) * 0.4)) * bodyW * 0.6;
              _ctx.beginPath();
              _ctx.ellipse(px, py, bodyW * 0.12, bodyW * 0.07, 0, 0, Math.PI * 2);
              _ctx.fill();
            }
          } else if (fish.sharkPattern === 'stripe') {
            _ctx.beginPath();
            _ctx.moveTo(-bodyL * 0.05, -bodyW * 0.3);
            _ctx.lineTo(bodyL * 0.35, 0);
            _ctx.lineTo(-bodyL * 0.05, bodyW * 0.3);
            _ctx.closePath();
            _ctx.fill();
          }
          _ctx.restore();
        }
      }
      _ctx.restore();
    }

    // Population chart overlay (in-canvas mini panel)
    if (showPopChartRef.current && popSamplesRef.current.length >= 2) {
      const pad = 8;
      const chartW = 300;
      const chartH = 140;
      const panelRect = panelRef.current?.getBoundingClientRect();
      const panelH = panelRect?.height || _canvas.height;
      const x = pad + 6;
      const y = panelH - chartH - pad - 6;
      const samples = popSamplesRef.current;
      // Determine time window (last 5 minutes)
      const nowMs = samples[samples.length - 1].tMs;
      const windowMs = 5 * 60 * 1000;
      const startMs = Math.max(0, nowMs - windowMs);
      const windowed = samples.filter(s => s.tMs >= startMs);
      const maxY = Math.max(1, ...windowed.map(s => Math.max(s.fish, s.sharks)));
      const toX = (tMs: number) => x + ((tMs - startMs) / Math.max(1, windowMs)) * chartW;
      const toY = (v: number) => y + chartH - (v / maxY) * chartH;
      // Background
      _ctx.save();
      _ctx.fillStyle = 'rgba(0,0,0,0.35)';
      _ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      _ctx.lineWidth = 1;
      _ctx.beginPath(); _ctx.rect(x - 6, y - 6, chartW + 12, chartH + 12); _ctx.fill(); _ctx.stroke();
      // Grid
      _ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      for (let i = 1; i < 5; i++) {
        const gy = y + (i * chartH) / 5;
        _ctx.beginPath(); _ctx.moveTo(x, gy); _ctx.lineTo(x + chartW, gy); _ctx.stroke();
      }
      // Fish line (teal)
      _ctx.strokeStyle = 'hsl(190 80% 60%)';
      _ctx.lineWidth = 1.8;
      _ctx.beginPath();
      let started = false;
      for (const s of windowed) {
        const px = toX(s.tMs); const py = toY(s.fish);
        if (!started) { _ctx.moveTo(px, py); started = true; } else { _ctx.lineTo(px, py); }
      }
      _ctx.stroke();
      // Sharks line (gray-blue)
      _ctx.strokeStyle = 'hsl(210 10% 70%)';
      _ctx.beginPath(); started = false;
      for (const s of windowed) {
        const px = toX(s.tMs); const py = toY(s.sharks);
        if (!started) { _ctx.moveTo(px, py); started = true; } else { _ctx.lineTo(px, py); }
      }
      _ctx.stroke();
      // Food line (amber)
      _ctx.strokeStyle = '#eab308';
      _ctx.beginPath(); started = false;
      for (const s of windowed) {
        const px = toX(s.tMs); const py = toY(s.food);
        if (!started) { _ctx.moveTo(px, py); started = true; } else { _ctx.lineTo(px, py); }
      }
      _ctx.stroke();
      // Legend
      _ctx.fillStyle = 'rgba(255,255,255,0.9)';
      _ctx.font = '10px sans-serif';
      _ctx.fillText('Populations (5 min)', x, y - 10);
      // fish legend
      _ctx.fillStyle = 'hsl(190 80% 60%)'; _ctx.fillRect(x, y + chartH + 2, 10, 3);
      _ctx.fillStyle = 'rgba(255,255,255,0.85)'; _ctx.fillText('Fish', x + 14, y + chartH + 5);
      // shark legend
      _ctx.fillStyle = 'hsl(210 10% 70%)'; _ctx.fillRect(x + 54, y + chartH + 2, 10, 3);
      _ctx.fillStyle = 'rgba(255,255,255,0.85)'; _ctx.fillText('Sharks', x + 68, y + chartH + 5);
      // food legend
      _ctx.fillStyle = '#eab308'; _ctx.fillRect(x + 120, y + chartH + 2, 10, 3);
      _ctx.fillStyle = 'rgba(255,255,255,0.85)'; _ctx.fillText('Food', x + 134, y + chartH + 5);
      _ctx.restore();
    }
  };

  const loop = (ts: number) => {
    const last = lastTsRef.current || ts;
    const dt = Math.min(32, ts - last); // cap delta for stability
    lastTsRef.current = ts;
    update(dt);
    draw();
    rafRef.current = requestAnimationFrame(loop);
  };

  useEffect(() => {
    resizeCanvas();
    const ro = new ResizeObserver(() => resizeCanvas());
    if (panelRef.current) ro.observe(panelRef.current);
    resizeObsRef.current = ro;
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      resizeObsRef.current?.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-0" />
  );
});

// Helpers
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
function normalizeAngle(a: number): number { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function drawEllipse(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
}

